import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
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
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
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

    // Output API URL and key
    new cdk.CfnOutput(this, "GraphQLApiUrl", {
      value: api.graphqlUrl,
      description: "The URL of your GraphQL API",
    });

    new cdk.CfnOutput(this, "GraphQLApiKey", {
      value: api.apiKey || "N/A",
      description: "The API Key for your GraphQL API",
    });
  }
}
