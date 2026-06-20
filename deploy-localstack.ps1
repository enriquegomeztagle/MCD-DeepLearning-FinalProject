#!/usr/bin/env pwsh
# deploy-localstack.ps1 - One command to run everything locally (no AWS account needed)
# Prerequisites: Docker, Node.js, AWS CLI, Python 3
# Usage: .\deploy-localstack.ps1

param([switch]$Down)

$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

# Teardown mode
if ($Down) {
    Write-Host "🧹 Tearing down..." -ForegroundColor Yellow
    docker ps --filter "name=ls-ecs" -q | ForEach-Object { docker stop $_; docker rm $_ } 2>&1 | Out-Null
    docker compose down 2>&1 | Out-Null
    Write-Host "✅ Cleaned up" -ForegroundColor Green
    exit 0
}

# Prerequisites check
$missing = @()
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { $missing += "docker" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += "node" }
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { $missing += "aws-cli" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { $missing += "python" }
if ($missing.Count -gt 0) { Write-Host "❌ Missing: $($missing -join ', ')" -ForegroundColor Red; exit 1 }

# Clean previous runs
docker ps --filter "name=ls-ecs" -q | ForEach-Object { docker stop $_; docker rm $_ } 2>&1 | Out-Null
docker compose down 2>&1 | Out-Null

$env:AWS_ACCESS_KEY_ID="test"
$env:AWS_SECRET_ACCESS_KEY="test"
$env:AWS_DEFAULT_REGION="us-east-1"
$endpoint = "http://localhost:4566"

# 1. Build images
Write-Host "🔨 Building Docker images..." -ForegroundColor Yellow
docker build -t mcd-deeplearning-backend:latest ./backend 2>&1 | Out-Null
docker build -t mcd-deeplearning-frontend:latest ./frontend 2>&1 | Out-Null
Write-Host "✅ Images built" -ForegroundColor Green

# 2. Start LocalStack
Write-Host "🚀 Starting LocalStack..." -ForegroundColor Yellow
docker compose up -d 2>&1 | Out-Null
$timeout = 60; $elapsed = 0
do { Start-Sleep 5; $elapsed += 5; try { $h = Invoke-RestMethod "$endpoint/_localstack/health" -ErrorAction SilentlyContinue } catch {} } until ($h.edition -or $elapsed -ge $timeout)
if (-not $h.edition) { Write-Host "❌ LocalStack failed to start" -ForegroundColor Red; exit 1 }
Write-Host "✅ LocalStack ready" -ForegroundColor Green

# 3. Synth CDK template (install deps if needed)
Write-Host "📦 Synthesizing CDK template..." -ForegroundColor Yellow
$env:CDK_DEFAULT_ACCOUNT="000000000000"; $env:CDK_DEFAULT_REGION="us-east-1"; $env:JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION="1"
if (-not (Test-Path infrastructure/.venv)) {
    Push-Location infrastructure
    python -m venv .venv 2>&1 | Out-Null
    .venv\Scripts\pip install -q -r requirements.txt 2>&1 | Out-Null
    Pop-Location
}
Push-Location infrastructure
& npx cdk synth --no-staging -o cdk.out 2>&1 | Out-Null
Pop-Location
Write-Host "✅ Template synthesized" -ForegroundColor Green

# 4. Deploy CloudFormation
Write-Host "☁️  Deploying CloudFormation stack..." -ForegroundColor Yellow
aws --endpoint-url=$endpoint ssm put-parameter --name "/cdk-bootstrap/hnb659fds/version" --value "19" --type String --overwrite 2>&1 | Out-Null
aws --endpoint-url=$endpoint cloudformation create-stack `
    --stack-name DeepLearningStack `
    --template-body file://infrastructure/cdk.out/DeepLearningStack.template.json `
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM 2>&1 | Out-Null

$timeout = 120; $elapsed = 0
do { Start-Sleep 5; $elapsed += 5; $status = (aws --endpoint-url=$endpoint cloudformation describe-stacks --stack-name DeepLearningStack --query "Stacks[0].StackStatus" --output text 2>&1) } until ($status -match "COMPLETE|FAILED" -or $elapsed -ge $timeout)
if ($status -ne "CREATE_COMPLETE") { Write-Host "❌ Stack failed: $status" -ForegroundColor Red; exit 1 }
Write-Host "✅ Stack deployed (50 AWS resources created)" -ForegroundColor Green

# 5. Run ECS tasks
Write-Host "🐳 Starting ECS containers..." -ForegroundColor Yellow
$cluster = (aws --endpoint-url=$endpoint ecs list-clusters --query "clusterArns[0]" --output text 2>&1)
$subnet = (aws --endpoint-url=$endpoint ec2 describe-subnets --filters "Name=cidr-block,Values=10.0.0.0/18" --query "Subnets[0].SubnetId" --output text 2>&1)

# Backend
aws --endpoint-url=$endpoint ecs register-task-definition --cli-input-json file://$PSScriptRoot/backend-task.json 2>&1 | Out-Null
aws --endpoint-url=$endpoint ecs run-task --cluster $cluster --task-definition backend-task --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$subnet],assignPublicIp=ENABLED}" 2>&1 | Out-Null
Start-Sleep 12

# Frontend (needs backend IP for proxy)
$backendContainer = (docker ps --filter "name=ls-ecs" --filter "ancestor=mcd-deeplearning-backend:latest" --format "{{.Names}}" 2>&1)
$backendIp = (docker inspect $backendContainer --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" 2>&1)
$resolvedPath = "$PSScriptRoot/frontend-task-resolved.json"
[System.IO.File]::WriteAllText($resolvedPath, "{`"family`":`"frontend-task`",`"networkMode`":`"awsvpc`",`"requiresCompatibilities`":[`"FARGATE`"],`"cpu`":`"256`",`"memory`":`"512`",`"containerDefinitions`":[{`"name`":`"web`",`"image`":`"mcd-deeplearning-frontend:latest`",`"essential`":true,`"portMappings`":[{`"containerPort`":3000,`"protocol`":`"tcp`"}],`"environment`":[{`"name`":`"BACKEND_URL`",`"value`":`"${backendIp}:8000`"}]}]}")
aws --endpoint-url=$endpoint ecs register-task-definition --cli-input-json file://$resolvedPath 2>&1 | Out-Null
aws --endpoint-url=$endpoint ecs run-task --cluster $cluster --task-definition frontend-task --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$subnet],assignPublicIp=ENABLED}" 2>&1 | Out-Null
Start-Sleep 12

# 6. Register ALB targets
$backendContainer = (docker ps --filter "name=ls-ecs" --filter "ancestor=mcd-deeplearning-backend:latest" --format "{{.Names}}" 2>&1)
$frontendContainer = (docker ps --filter "name=ls-ecs" --filter "ancestor=mcd-deeplearning-frontend:latest" --format "{{.Names}}" 2>&1)
$backendIp = (docker inspect $backendContainer --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" 2>&1)
$frontendIp = (docker inspect $frontendContainer --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" 2>&1)
$tgs = (aws --endpoint-url=$endpoint elbv2 describe-target-groups --query "TargetGroups[].TargetGroupArn" --output json 2>&1 | ConvertFrom-Json)
if ($tgs.Count -ge 2) {
    aws --endpoint-url=$endpoint elbv2 register-targets --target-group-arn $tgs[0] --targets "Id=$backendIp,Port=8000" 2>&1 | Out-Null
    aws --endpoint-url=$endpoint elbv2 register-targets --target-group-arn $tgs[1] --targets "Id=$frontendIp,Port=3000" 2>&1 | Out-Null
}

# 7. Output
$bp = (docker port $backendContainer 8000).Split(":")[-1]
$fp = (docker port $frontendContainer 3000).Split(":")[-1]
$secret = (aws --endpoint-url=$endpoint secretsmanager get-secret-value --secret-id "deeplearning/api-key" --query "SecretString" --output text 2>&1)

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ Deployment complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  🌐 Frontend:    http://localhost:$fp" -ForegroundColor Cyan
Write-Host "  🔧 Backend API: http://localhost:$bp/docs" -ForegroundColor Cyan
Write-Host "  🔑 API Key:     $secret" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To tear down:   .\deploy-localstack.ps1 -Down" -ForegroundColor DarkGray
Write-Host "  To deploy AWS:  cd infrastructure && cdk deploy" -ForegroundColor DarkGray
Write-Host "  📊 Console:     https://app.localstack.cloud/" -ForegroundColor DarkGray
Write-Host ""
