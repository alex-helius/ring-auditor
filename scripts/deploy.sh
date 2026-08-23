#!/usr/bin/env bash
# Deploy the ring auditor to ECS on its own, every resource named
# ring-auditor-test-* and tagged ring-auditor-test=1.
#
#   scripts/deploy.sh up        build, publish, create, start
#   scripts/deploy.sh status    address and health
#   scripts/deploy.sh down      delete everything it created
#
# The page is served over HTTPS through a CloudFront distribution on an amazon
# hostname. It is built with the service URLs baked in. Point the ring RPC it talks
# to at this deployment's origin (RING_RPC_ALLOW_ORIGINS, RING_RPC_WEBAUTHN_RP_ID).
#
# Needs aws (with write access), docker, jq, git.
#
# Environment, defaults from .env.deploy. `up` looks the ring RPC, the prover
# and the indexer up in CloudFront (the zolana-rings-test stack) and rewrites
# those three lines.
#   RING_RPC_URL, PROVER_URL, INDEXER_URL, SOLANA_RPC_URL, ZOLANA_TREE
#   AWS_REGION          default eu-north-1
#   DEPLOY_VPC          VPC id, default the account's default VPC
set -euo pipefail

usage() {
    sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
}

[[ $# -eq 1 ]] || usage
command="$1"

root="$(git rev-parse --show-toplevel)"
cd "$root"
while IFS='=' read -r name value; do
    [[ -n "$name" && "$name" != \#* && -z "${!name:-}" ]] && export "$name=$value"
done < .env.deploy
region="${AWS_REGION:-eu-north-1}"
prefix="ring-auditor-test"
tag_spec="Key=$prefix,Value=1"
ecs_tag_spec="key=$prefix,value=1"
account="$(aws sts get-caller-identity --query Account --output text)"
registry="$account.dkr.ecr.$region.amazonaws.com"
repository="ring-auditor"
cluster="$prefix"
role="$prefix-exec"
log_group="/$prefix"
security_group="$prefix-sg"
load_balancer="$prefix"
port=80
container_port=3000

aws_() { aws --region "$region" "$@"; }
log() { printf '%s\n' "$*" >&2; }

vpc_and_subnets() {
    local vpc="${DEPLOY_VPC:-}"
    if [[ -z "$vpc" ]]; then
        vpc="$(aws_ ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)"
    fi
    [[ "$vpc" != None && -n "$vpc" ]] || { log "no default VPC, set DEPLOY_VPC"; exit 1; }
    local subnets
    subnets="$(aws_ ec2 describe-subnets --filters "Name=vpc-id,Values=$vpc" "Name=map-public-ip-on-launch,Values=true" \
        --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
    [[ -n "$subnets" ]] || { log "VPC $vpc has no public subnets"; exit 1; }
    echo "$vpc" "$subnets"
}

ensure_security_group() {
    local vpc="$1" id
    id="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$security_group" "Name=vpc-id,Values=$vpc" \
        --query 'SecurityGroups[0].GroupId' --output text)"
    if [[ "$id" == None || -z "$id" ]]; then
        id="$(aws_ ec2 create-security-group --group-name "$security_group" --description "$prefix" --vpc-id "$vpc" \
            --tag-specifications "ResourceType=security-group,Tags=[{$tag_spec}]" --query GroupId --output text)"
        aws_ ec2 authorize-security-group-ingress --group-id "$id" --protocol tcp --port "$container_port" --cidr 0.0.0.0/0 >/dev/null
    fi
    echo "$id"
}

ensure_role() {
    if ! aws_ iam get-role --role-name "$role" >/dev/null 2>&1; then
        aws_ iam create-role --role-name "$role" --tags "$tag_spec" --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{"Effect": "Allow", "Principal": {"Service": "ecs-tasks.amazonaws.com"}, "Action": "sts:AssumeRole"}]
        }' >/dev/null
        aws_ iam attach-role-policy --role-name "$role" \
            --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
        log "waiting for the role to propagate"
        sleep 15
    fi
    aws_ iam get-role --role-name "$role" --query Role.Arn --output text
}

ensure_load_balancer() {
    local vpc="$1" subnets="$2" arn group
    arn="$(aws_ elbv2 describe-load-balancers --names "$load_balancer" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
    if [[ "$arn" == None || -z "$arn" ]]; then
        local subnet_list
        IFS=, read -r -a subnet_list <<< "$subnets"
        arn="$(aws_ elbv2 create-load-balancer --name "$load_balancer" --type network --scheme internet-facing \
            --subnets "${subnet_list[@]}" --tags "$tag_spec" --query 'LoadBalancers[0].LoadBalancerArn' --output text)"
    fi
    # One task runs in one zone, so the nodes of the other zones have no target.
    # Without cross-zone they accept the connection and never answer, and two of
    # the three balancer addresses time out.
    aws_ elbv2 modify-load-balancer-attributes --load-balancer-arn "$arn" \
        --attributes Key=load_balancing.cross_zone.enabled,Value=true >/dev/null
    group="$(aws_ elbv2 describe-target-groups --names "$prefix" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
    if [[ "$group" == None || -z "$group" ]]; then
        group="$(aws_ elbv2 create-target-group --name "$prefix" --protocol TCP --port "$container_port" --vpc-id "$vpc" \
            --target-type ip --health-check-protocol HTTP --health-check-path / --tags "$tag_spec" \
            --query 'TargetGroups[0].TargetGroupArn' --output text)"
    fi
    if [[ -z "$(aws_ elbv2 describe-listeners --load-balancer-arn "$arn" --query "Listeners[?Port==\`$port\`].ListenerArn" --output text)" ]]; then
        aws_ elbv2 create-listener --load-balancer-arn "$arn" --protocol TCP --port "$port" \
            --default-actions "Type=forward,TargetGroupArn=$group" --tags "$tag_spec" >/dev/null
    fi
    aws_ elbv2 describe-load-balancers --load-balancer-arns "$arn" --query 'LoadBalancers[0].DNSName' --output text
}

# CloudFront in front of the load balancer gives HTTPS on an amazon hostname
# with Amazon's certificate, no domain to validate.
ensure_distribution() {
    local name="$1" origin="$2" origin_port="$3" id
    id="$(aws_ cloudfront list-distributions --query "DistributionList.Items[?Comment=='$name'].Id | [0]" --output text 2>/dev/null || true)"
    if [[ "$id" == None || -z "$id" ]]; then
        id="$(aws_ cloudfront create-distribution --distribution-config "$(jq -n --arg name "$name" --arg origin "$origin" --argjson port "$origin_port" '{
            CallerReference: $name, Comment: $name, Enabled: true, HttpVersion: "http2", PriceClass: "PriceClass_100",
            Origins: {Quantity: 1, Items: [{Id: "origin", DomainName: $origin,
                CustomOriginConfig: {HTTPPort: $port, HTTPSPort: 443, OriginProtocolPolicy: "http-only",
                    OriginReadTimeout: 60, OriginKeepaliveTimeout: 5, OriginSslProtocols: {Quantity: 1, Items: ["TLSv1.2"]}}}]},
            DefaultCacheBehavior: {TargetOriginId: "origin", ViewerProtocolPolicy: "redirect-to-https",
                AllowedMethods: {Quantity: 7, Items: ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
                    CachedMethods: {Quantity: 2, Items: ["GET","HEAD"]}},
                CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
                OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac", Compress: true}
        }')" --query 'Distribution.Id' --output text)"
        aws_ cloudfront tag-resource --resource "arn:aws:cloudfront::$account:distribution/$id" --tags "Items=[{$tag_spec}]"
    fi
    aws_ cloudfront get-distribution --id "$id" --query 'Distribution.DomainName' --output text
}

remove_distribution() {
    local name="$1" id etag
    id="$(aws_ cloudfront list-distributions --query "DistributionList.Items[?Comment=='$name'].Id | [0]" --output text 2>/dev/null || true)"
    [[ "$id" != None && -n "$id" ]] || return 0
    etag="$(aws_ cloudfront get-distribution-config --id "$id" --query ETag --output text)"
    aws_ cloudfront get-distribution-config --id "$id" --query DistributionConfig | jq '.Enabled = false' > "/tmp/$name.json"
    etag="$(aws_ cloudfront update-distribution --id "$id" --if-match "$etag" --distribution-config "file:///tmp/$name.json" --query ETag --output text)"
    aws_ cloudfront wait distribution-deployed --id "$id"
    aws_ cloudfront delete-distribution --id "$id" --if-match "$etag"
}

build_image() {
    local tag="$1"
    local image="$registry/$repository:$tag"
    if aws_ ecr describe-images --repository-name "$repository" --image-ids "imageTag=$tag" >/dev/null 2>&1; then
        echo "$image"
        return
    fi
    docker buildx build --platform linux/amd64 --load --tag "$image" \
        --build-arg "NEXT_PUBLIC_RING_RPC_URL=$RING_RPC_URL" \
        --build-arg "NEXT_PUBLIC_SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}" \
        --build-arg "NEXT_PUBLIC_INDEXER_URL=$INDEXER_URL" \
        --build-arg "NEXT_PUBLIC_PROVER_URL=$PROVER_URL" \
        --build-arg "NEXT_PUBLIC_ZOLANA_TREE=${ZOLANA_TREE:-trEEbaNobcTESNmtsPBj3FX27q5sDCQePV2kb12FYho}" \
        . >&2
    aws_ ecr get-login-password | docker login --username AWS --password-stdin "$registry" >&2
    docker push "$image" >&2
    echo "$image"
}

register_task() {
    local image="$1" role_arn="$2"
    aws_ ecs register-task-definition --family "$prefix" --tags "$ecs_tag_spec" \
        --requires-compatibilities FARGATE --network-mode awsvpc --cpu 512 --memory 1024 \
        --execution-role-arn "$role_arn" --runtime-platform cpuArchitecture=X86_64,operatingSystemFamily=LINUX \
        --container-definitions "$(jq -n --arg image "$image" --arg group "$log_group" --arg region "$region" --argjson port "$container_port" '[
            {name: "auditor", image: $image, essential: true,
             portMappings: [{containerPort: $port, protocol: "tcp"}],
             logConfiguration: {logDriver: "awslogs", options: {"awslogs-group": $group, "awslogs-region": $region, "awslogs-stream-prefix": "auditor"}}}
        ]')" --query 'taskDefinition.taskDefinitionArn' --output text
}

ensure_service() {
    local task_definition="$1" subnets="$2" sg="$3" status group
    status="$(aws_ ecs describe-services --cluster "$cluster" --services "$prefix" --query 'services[0].status' --output text 2>/dev/null || true)"
    if [[ "$status" == ACTIVE ]]; then
        aws_ ecs update-service --cluster "$cluster" --service "$prefix" --task-definition "$task_definition" --force-new-deployment >/dev/null
    else
        group="$(aws_ elbv2 describe-target-groups --names "$prefix" --query 'TargetGroups[0].TargetGroupArn' --output text)"
        aws_ ecs create-service --cluster "$cluster" --service-name "$prefix" --task-definition "$task_definition" \
            --desired-count 1 --launch-type FARGATE --tags "$ecs_tag_spec" --health-check-grace-period-seconds 60 \
            --load-balancers "targetGroupArn=$group,containerName=auditor,containerPort=$container_port" \
            --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=ENABLED}" >/dev/null
    fi
}

# The ring RPC, the prover and the indexer are the zolana-rings-test
# distributions. The page is served over HTTPS, so every one of them has to be,
# or the browser blocks the read as mixed content.
resolve_service_urls() {
    local name host var
    for name in ring-rpc prover indexer; do
        host="$(aws_ cloudfront list-distributions --query "DistributionList.Items[?Comment=='zolana-rings-test-$name'].DomainName | [0]" --output text 2>/dev/null || true)"
        [[ "$host" != None && -n "$host" ]] || { log "no zolana-rings-test-$name distribution, deploy the zolana ring test stack first"; exit 1; }
        case "$name" in
            ring-rpc) var=RING_RPC_URL ;;
            prover) var=PROVER_URL ;;
            *) var=INDEXER_URL ;;
        esac
        export "$var=https://$host"
        sed -i.bak "s#^$var=.*#$var=https://$host#" .env.deploy && rm -f .env.deploy.bak
    done
}

up() {
    resolve_service_urls
    : "${INDEXER_URL:?set INDEXER_URL}"
    [[ -z "$(git status --porcelain --untracked-files=no -- . ':!.env.deploy')" ]] || { log "working tree is dirty"; exit 1; }
    local tag
    tag="$(git rev-parse --short=12 HEAD)"

    log "== network, load balancer, role, logs, cluster"
    local vpc subnets sg role_arn dns
    read -r vpc subnets <<< "$(vpc_and_subnets)"
    sg="$(ensure_security_group "$vpc")"
    role_arn="$(ensure_role)"
    dns="$(ensure_load_balancer "$vpc" "$subnets")"
    aws_ logs describe-log-groups --log-group-name-prefix "$log_group" --query "logGroups[?logGroupName=='$log_group']" --output text | grep -q . \
        || aws_ logs create-log-group --log-group-name "$log_group" --tags "$prefix=1"
    aws_ ecs describe-clusters --clusters "$cluster" --query "clusters[?status=='ACTIVE']" --output text | grep -q . \
        || aws_ ecs create-cluster --cluster-name "$cluster" --tags "$ecs_tag_spec" >/dev/null
    aws_ ecr describe-repositories --repository-names "$repository" >/dev/null 2>&1 \
        || aws_ ecr create-repository --repository-name "$repository" --image-tag-mutability IMMUTABLE --tags "$tag_spec" >/dev/null

    log "== image"
    local image task_definition
    image="$(build_image "$tag")"

    log "== service"
    task_definition="$(register_task "$image" "$role_arn")"
    ensure_service "$task_definition" "$subnets" "$sg"
    log "== https"
    local host
    host="$(ensure_distribution "$prefix" "$dns" "$port")"
    log "waiting for the service to stabilize"
    aws_ ecs wait services-stable --cluster "$cluster" --services "$prefix"
    log "passkeys need the ring RPC to name this page, RING_RPC_ALLOW_ORIGINS=https://$host RING_RPC_WEBAUTHN_RP_ID=$host"
    status
}

status() {
    local host
    host="$(aws_ cloudfront list-distributions --query "DistributionList.Items[?Comment=='$prefix'].DomainName | [0]" --output text)"
    echo "auditor   https://$host"
    curl -sf --max-time 15 -o /dev/null "https://$host/" && echo "ok" || echo "not reachable over https yet"
    echo "logs      aws logs tail $log_group --region $region --follow"
}

down() {
    if [[ "$(aws_ ecs describe-services --cluster "$cluster" --services "$prefix" --query 'services[0].status' --output text 2>/dev/null)" == ACTIVE ]]; then
        aws_ ecs delete-service --cluster "$cluster" --service "$prefix" --force >/dev/null
        aws_ ecs wait services-inactive --cluster "$cluster" --services "$prefix" 2>/dev/null || true
    fi
    local td
    for td in $(aws_ ecs list-task-definitions --family-prefix "$prefix" --query 'taskDefinitionArns[]' --output text); do
        aws_ ecs deregister-task-definition --task-definition "$td" >/dev/null
    done
    aws_ ecs delete-cluster --cluster "$cluster" >/dev/null 2>&1 || true
    remove_distribution "$prefix"
    local lb
    lb="$(aws_ elbv2 describe-load-balancers --names "$load_balancer" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)"
    if [[ "$lb" != None && -n "$lb" ]]; then
        aws_ elbv2 delete-load-balancer --load-balancer-arn "$lb"
        aws_ elbv2 wait load-balancers-deleted --load-balancer-arns "$lb"
    fi
    local group
    group="$(aws_ elbv2 describe-target-groups --names "$prefix" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)"
    [[ "$group" == None || -z "$group" ]] || aws_ elbv2 delete-target-group --target-group-arn "$group"
    local sg
    sg="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$security_group" --query 'SecurityGroups[0].GroupId' --output text)"
    [[ "$sg" == None || -z "$sg" ]] || { sleep 20; aws_ ec2 delete-security-group --group-id "$sg"; }
    aws_ logs delete-log-group --log-group-name "$log_group" 2>/dev/null || true
    aws_ ecr delete-repository --repository-name "$repository" --force >/dev/null 2>&1 || true
    if aws_ iam get-role --role-name "$role" >/dev/null 2>&1; then
        aws_ iam detach-role-policy --role-name "$role" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
        aws_ iam delete-role --role-name "$role"
    fi
    echo "removed every $prefix-* resource"
}

case "$command" in
    up) up ;;
    status) status ;;
    down) down ;;
    *) usage ;;
esac
