import os
import aws_cdk as cdk
from infrastructure.deeplearning_stack import DeepLearningStack

app = cdk.App()

DeepLearningStack(
    app,
    "DeepLearningStack",
    env=cdk.Environment(
        account=os.getenv("CDK_DEFAULT_ACCOUNT"),
        region=os.getenv("CDK_DEFAULT_REGION"),
    ),
)

app.synth()
