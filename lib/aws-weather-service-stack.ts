import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";

export class AwsWeatherServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table for caching air quality data
    // Uses composite key (latitude + longitude) and TTL for automatic expiration
    const cacheTable = new dynamodb.Table(this, "AirQualityCache", {
      tableName: "air-quality-cache",
      partitionKey: { name: "locationKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/testing - change for production
    });

    // Lambda function to fetch air quality data from Open-Meteo API
    const getAirQualityLambda = new lambdaNodejs.NodejsFunction(
      this,
      "GetAirQualityFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "handler",
        entry: path.join(__dirname, "../lambda/getAirQuality.ts"),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        environment: {
          CACHE_TABLE_NAME: cacheTable.tableName,
          CACHE_TTL_SECONDS: "3600", // 1 hour cache expiration
        },
        bundling: {
          forceDockerBundling: false,
        },
      }
    );

    // Grant Lambda permissions to read/write to DynamoDB cache table
    cacheTable.grantReadWriteData(getAirQualityLambda);

    // AppSync GraphQL API
    const api = new appsync.GraphqlApi(this, "AirQualityApi", {
      name: "air-quality-api",
      definition: appsync.Definition.fromFile(
        path.join(__dirname, "../schema.graphql")
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.IAM,
        },
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
      },
      xrayEnabled: true,
    });

    // Connect Lambda as data source and create resolver
    const lambdaDataSource = api.addLambdaDataSource(
      "LambdaDataSource",
      getAirQualityLambda
    );

    lambdaDataSource.createResolver("GetAirQualityResolver", {
      typeName: "Query",
      fieldName: "getAirQuality",
    });

    // Cognito Identity Pool for guest (unauthenticated) mobile access.
    const identityPool = new cognito.CfnIdentityPool(this, "GuestIdentityPool", {
      allowUnauthenticatedIdentities: true,
      identityPoolName: "air-quality-guest-identity-pool",
    });

    const unauthenticatedRole = new iam.Role(this, "GuestIdentityPoolUnauthRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "unauthenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      description: "Unauthenticated role scoped to AppSync GraphQL calls only",
    });

    unauthenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["appsync:GraphQL"],
        resources: [`${api.arn}/*`],
      })
    );

    new cognito.CfnIdentityPoolRoleAttachment(this, "GuestIdentityPoolRoleAttachment", {
      identityPoolId: identityPool.ref,
      roles: {
        unauthenticated: unauthenticatedRole.roleArn,
      },
    });

    // Output API URL and guest identity pool settings
    new cdk.CfnOutput(this, "GraphQLApiUrl", {
      value: api.graphqlUrl,
      description: "The URL of your GraphQL API",
    });

    new cdk.CfnOutput(this, "GraphQLApiRegion", {
      value: this.region,
      description: "Region for AppSync and Cognito Identity Pool",
    });

    new cdk.CfnOutput(this, "GuestIdentityPoolId", {
      value: identityPool.ref,
      description: "Cognito Identity Pool ID for unauthenticated mobile access",
    });

    new cdk.CfnOutput(this, "GuestIdentityPoolUnauthRoleArn", {
      value: unauthenticatedRole.roleArn,
      description: "IAM role used by unauthenticated identities",
    });
  }
}
