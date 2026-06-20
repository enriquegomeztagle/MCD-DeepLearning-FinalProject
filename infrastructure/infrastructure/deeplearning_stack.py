from pathlib import Path
from aws_cdk import (
    Stack,
    CfnOutput,
    RemovalPolicy,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_ecr_assets as ecr_assets,
    aws_secretsmanager as secretsmanager,
)
from aws_cdk.aws_ecr_assets import Platform
from constructs import Construct


class DeepLearningStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        vpc = ec2.Vpc(self, "DLVpc", max_azs=2, nat_gateways=1)

        cluster = ecs.Cluster(self, "DLCluster", vpc=vpc)

        api_key_secret = secretsmanager.Secret(
            self,
            "ApiKeySecret",
            secret_name="deeplearning/api-key",
            generate_secret_string=secretsmanager.SecretStringGenerator(
                exclude_punctuation=True,
                password_length=32,
            ),
            removal_policy=RemovalPolicy.DESTROY,
        )

        project_root = Path(__file__).resolve().parents[2]

        backend_image = ecr_assets.DockerImageAsset(
            self,
            "BackendImage",
            directory=str(project_root / "backend"),
            platform=Platform.LINUX_AMD64,
        )

        frontend_image = ecr_assets.DockerImageAsset(
            self,
            "FrontendImage",
            directory=str(project_root / "frontend"),
            platform=Platform.LINUX_AMD64,
        )

        backend = ecs_patterns.ApplicationLoadBalancedFargateService(
            self,
            "BackendService",
            cluster=cluster,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_docker_image_asset(backend_image),
                container_port=8000,
                secrets={
                    "API_KEY": ecs.Secret.from_secrets_manager(api_key_secret),
                },
            ),
            desired_count=1,
            cpu=256,
            memory_limit_mib=512,
            public_load_balancer=True,
        )

        frontend = ecs_patterns.ApplicationLoadBalancedFargateService(
            self,
            "FrontendService",
            cluster=cluster,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_docker_image_asset(frontend_image),
                container_port=3000,
                environment={
                    "VITE_API_URL": f"http://{backend.load_balancer.load_balancer_dns_name}",
                },
            ),
            desired_count=1,
            cpu=256,
            memory_limit_mib=512,
            public_load_balancer=True,
        )

        CfnOutput(self, "FrontendURL", value=f"http://{frontend.load_balancer.load_balancer_dns_name}")
        CfnOutput(self, "BackendURL", value=f"http://{backend.load_balancer.load_balancer_dns_name}")
        CfnOutput(self, "ApiKeySecretArn", value=api_key_secret.secret_arn)
