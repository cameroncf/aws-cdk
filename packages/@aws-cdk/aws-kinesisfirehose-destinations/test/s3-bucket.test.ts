import '@aws-cdk/assert-internal/jest';
import { ABSENT, Capture, MatchStyle, ResourcePart, anything, arrayWith } from '@aws-cdk/assert-internal';
import * as iam from '@aws-cdk/aws-iam';
import * as firehose from '@aws-cdk/aws-kinesisfirehose';
import * as kms from '@aws-cdk/aws-kms';
import * as lambda from '@aws-cdk/aws-lambda';
import * as logs from '@aws-cdk/aws-logs';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import * as firehosedestinations from '../lib';

describe('S3 destination', () => {
  let stack: cdk.Stack;
  let bucket: s3.IBucket;
  let destinationRole: iam.IRole;

  beforeEach(() => {
    stack = new cdk.Stack();
    bucket = new s3.Bucket(stack, 'Bucket');
    destinationRole = new iam.Role(stack, 'Destination Role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
  });

  it('provides defaults when no configuration is provided', () => {
    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket, { role: destinationRole })],
    });

    expect(stack).toHaveResource('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: {
        BucketARN: stack.resolve(bucket.bucketArn),
        CloudWatchLoggingOptions: {
          Enabled: true,
          LogGroupName: anything(),
          LogStreamName: anything(),
        },
        EncryptionConfiguration: {
          NoEncryptionConfig: 'NoEncryption',
        },
        RoleARN: stack.resolve(destinationRole.roleArn),
      },
    });
    expect(stack).toHaveResource('AWS::Logs::LogGroup');
    expect(stack).toHaveResource('AWS::Logs::LogStream');
  });

  it('creates a role when none is provided', () => {
    const capturedRoleArn = Capture.aString();

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket)],
    });

    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: {
        RoleARN: {
          'Fn::GetAtt': [
            capturedRoleArn.capture(),
            'Arn',
          ],
        },
      },
    });
    expect(stack).toMatchTemplate({
      [capturedRoleArn.capturedValue]: {
        Type: 'AWS::IAM::Role',
      },
    }, MatchStyle.SUPERSET);
  });

  it('grants encrypt/decrypt access to the destination encryptionKey', () => {
    const key = new kms.Key(stack, 'Key');

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket, {
        encryptionKey: key,
        role: destinationRole,
      })],
    });

    expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
      Roles: [stack.resolve(destinationRole.roleName)],
      PolicyDocument: {
        Statement: arrayWith({
          Action: [
            'kms:Decrypt',
            'kms:Encrypt',
            'kms:ReEncrypt*',
            'kms:GenerateDataKey*',
          ],
          Effect: 'Allow',
          Resource: stack.resolve(key.keyArn),
        }),
      },
    });
  });

  it('grants read/write access to the bucket', () => {
    const destination = new firehosedestinations.S3Bucket(bucket, { role: destinationRole });

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [destination],
    });

    expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
      Roles: [stack.resolve(destinationRole.roleName)],
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetObject*',
              's3:GetBucket*',
              's3:List*',
              's3:DeleteObject*',
              's3:PutObject*',
              's3:Abort*',
            ],
            Effect: 'Allow',
            Resource: [
              stack.resolve(bucket.bucketArn),
              { 'Fn::Join': ['', [stack.resolve(bucket.bucketArn), '/*']] },
            ],
          },
        ],
      },
    });
  });

  it('bucket and log group grants are depended on by delivery stream', () => {
    const logGroup = logs.LogGroup.fromLogGroupName(stack, 'Log Group', 'evergreen');
    const capturedPolicyId = Capture.aString();
    const destination = new firehosedestinations.S3Bucket(bucket, { role: destinationRole, logGroup });

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [destination],
    });

    expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
      PolicyName: capturedPolicyId.capture(),
      Roles: [stack.resolve(destinationRole.roleName)],
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetObject*',
              's3:GetBucket*',
              's3:List*',
              's3:DeleteObject*',
              's3:PutObject*',
              's3:Abort*',
            ],
            Effect: 'Allow',
            Resource: [
              stack.resolve(bucket.bucketArn),
              { 'Fn::Join': ['', [stack.resolve(bucket.bucketArn), '/*']] },
            ],
          },
          {
            Action: [
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            Effect: 'Allow',
            Resource: stack.resolve(logGroup.logGroupArn),
          },
        ],
      },
    });
    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      DependsOn: [capturedPolicyId.capturedValue],
    }, ResourcePart.CompleteDefinition);
  });

  describe('logging', () => {
    it('creates resources and configuration by default', () => {
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [new firehosedestinations.S3Bucket(bucket)],
      });

      expect(stack).toHaveResource('AWS::Logs::LogGroup');
      expect(stack).toHaveResource('AWS::Logs::LogStream');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        ExtendedS3DestinationConfiguration: {
          CloudWatchLoggingOptions: {
            Enabled: true,
            LogGroupName: anything(),
            LogStreamName: anything(),
          },
        },
      });
    });

    it('does not create resources or configuration if disabled', () => {
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [new firehosedestinations.S3Bucket(bucket, { logging: false })],
      });

      expect(stack).not.toHaveResource('AWS::Logs::LogGroup');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        ExtendedS3DestinationConfiguration: {
          CloudWatchLoggingOptions: ABSENT,
        },
      });
    });

    it('uses provided log group', () => {
      const logGroup = new logs.LogGroup(stack, 'Log Group');

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [new firehosedestinations.S3Bucket(bucket, { logGroup })],
      });

      expect(stack).toCountResources('AWS::Logs::LogGroup', 1);
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        ExtendedS3DestinationConfiguration: {
          CloudWatchLoggingOptions: {
            Enabled: true,
            LogGroupName: stack.resolve(logGroup.logGroupName),
            LogStreamName: anything(),
          },
        },
      });
    });

    it('throws error if logging disabled but log group provided', () => {
      const destination = new firehosedestinations.S3Bucket(bucket, { logging: false, logGroup: new logs.LogGroup(stack, 'Log Group') });

      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      })).toThrowError('logging cannot be set to false when logGroup is provided');
    });

    it('grants log group write permissions to destination role', () => {
      const logGroup = new logs.LogGroup(stack, 'Log Group');

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [new firehosedestinations.S3Bucket(bucket, { logGroup, role: destinationRole })],
      });

      expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
        Roles: [stack.resolve(destinationRole.roleName)],
        PolicyDocument: {
          Statement: arrayWith(
            {
              Action: [
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              Effect: 'Allow',
              Resource: stack.resolve(logGroup.logGroupArn),
            },
          ),
        },
      });
    });
  });

  describe('processing configuration', () => {

    it('correctly creates configuration for LambdaDataProcessor', () => {
      const lambdaFunction = new lambda.Function(stack, 'DataProcessorFunction', {
        runtime: lambda.Runtime.NODEJS_12_X,
        code: lambda.Code.fromInline('foo'),
        handler: 'bar',
      });
      const processor = new firehosedestinations.LambdaFunctionProcessor(lambdaFunction);
      const destination = new firehosedestinations.S3Bucket(bucket, {
        role: destinationRole,
        processors: [processor],
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResource('AWS::Lambda::Function');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        ExtendedS3DestinationConfiguration: {
          ProcessingConfiguration: {
            Enabled: true,
            Processors: [{
              Type: 'Lambda',
              Parameters: [
                {
                  ParameterName: 'RoleArn',
                  ParameterValue: stack.resolve(destinationRole.roleArn),
                },
                {
                  ParameterName: 'LambdaArn',
                  ParameterValue: stack.resolve(lambdaFunction.functionArn),
                },
              ],
            }],
          },
        },
      });
    });

    it('set all optional parameters', () => {
      const lambdaFunction = new lambda.Function(stack, 'DataProcessorFunction', {
        runtime: lambda.Runtime.NODEJS_12_X,
        code: lambda.Code.fromInline('foo'),
        handler: 'bar',
      });
      const processor = new firehosedestinations.LambdaFunctionProcessor(lambdaFunction, {
        bufferInterval: cdk.Duration.minutes(1),
        bufferSize: cdk.Size.mebibytes(1),
        retries: 5,
      });
      const destination = new firehosedestinations.S3Bucket(bucket, {
        role: destinationRole,
        processors: [processor],
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResource('AWS::Lambda::Function');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        ExtendedS3DestinationConfiguration: {
          ProcessingConfiguration: {
            Enabled: true,
            Processors: [{
              Type: 'Lambda',
              Parameters: [
                {
                  ParameterName: 'RoleArn',
                  ParameterValue: stack.resolve(destinationRole.roleArn),
                },
                {
                  ParameterName: 'LambdaArn',
                  ParameterValue: stack.resolve(lambdaFunction.functionArn),
                },
                {
                  ParameterName: 'BufferIntervalInSeconds',
                  ParameterValue: '60',
                },
                {
                  ParameterName: 'BufferSizeInMBs',
                  ParameterValue: '1',
                },
                {
                  ParameterName: 'NumberOfRetries',
                  ParameterValue: '5',
                },
              ],
            }],
          },
        },
      });
    });

    it('grants invoke access to the lambda function and delivery stream depends on grant', () => {
      const capturedPolicyId = Capture.aString();
      const lambdaFunction = new lambda.Function(stack, 'DataProcessorFunction', {
        runtime: lambda.Runtime.NODEJS_12_X,
        code: lambda.Code.fromInline('foo'),
        handler: 'bar',
      });
      const processor = new firehosedestinations.LambdaFunctionProcessor(lambdaFunction);
      const destination = new firehosedestinations.S3Bucket(bucket, {
        role: destinationRole,
        processors: [processor],
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
        PolicyName: capturedPolicyId.capture(),
        Roles: [stack.resolve(destinationRole.roleName)],
        PolicyDocument: {
          Statement: arrayWith(
            {
              Action: 'lambda:InvokeFunction',
              Effect: 'Allow',
              Resource: stack.resolve(lambdaFunction.functionArn),
            },
          ),
        },
      });
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        DependsOn: [capturedPolicyId.capturedValue],
      }, ResourcePart.CompleteDefinition);
    });

    it('throws error if more than one processor is provided', () => {
      const lambdaFunction = new lambda.Function(stack, 'DataProcessorFunction', {
        runtime: lambda.Runtime.NODEJS_12_X,
        code: lambda.Code.fromInline('foo'),
        handler: 'bar',
      });
      const processor = new firehosedestinations.LambdaFunctionProcessor(lambdaFunction);
      const destination = new firehosedestinations.S3Bucket(bucket, {
        role: destinationRole,
        processors: [processor, processor],
      });

      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      })).toThrowError('Only one processor is allowed per delivery stream destination');
    });
  });
});