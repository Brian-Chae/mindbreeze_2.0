#!/usr/bin/env bash
# T-10 사양 검증 (V-1.1, V-1.6, V-1.7)
source "$(dirname "$0")/common.sh"; IID="$(load instance_id)"
aws ec2 describe-instances --instance-ids "$IID" --query 'Reservations[0].Instances[0].[InstanceType,State.Name,MetadataOptions.HttpTokens,MetadataOptions.HttpEndpoint,IamInstanceProfile.Arn,PublicIpAddress,KeyName,SubnetId]' --output text
VOL="$(aws ec2 describe-instances --instance-ids "$IID" --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)"
aws ec2 describe-volumes --volume-ids "$VOL" --query 'Volumes[0].[VolumeId,Encrypted,Size,VolumeType]' --output text
aws ec2 describe-instance-attribute --instance-id "$IID" --attribute disableApiTermination --query DisableApiTermination.Value --output text
echo "EIP=$(load eip_ip)"
aws ssm describe-instance-information --filters Key=InstanceIds,Values="$IID" --query 'InstanceInformationList[0].[PingStatus,PlatformName,PlatformVersion,AgentVersion]' --output text
