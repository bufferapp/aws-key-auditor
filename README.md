# aws-key-auditor

Get all keys from an AWS account and send an email if a key is getting old

## Environment Variables

An example environment variable file:

```
AWS_ACCESS_KEY_ID=AKIAXXXXX
AWS_SECRET_ACCESS_KEY=XXXXX
SENDGRID_API_KEY=XXXXX
DAYS_WARN=80
DAYS_ERROR=90
EMAIL_TO=XXXXX
EMAIL_FROM=XXXXX
EMAIL_REPLY_TO=XXXXX
```

### AWS_ACCESS_KEY_ID

The AWS ID (yes this service does audit its own key)

### AWS_SECRET_ACCESS_KEY

The AWS secret

### SENDGRID_API_KEY

API Key for [Sendgrid](https://sendgrid.com/)

### DAYS_WARN

The number of days a key can live before marked as needing to be deleted _soon_

### DAYS_ERROR

The number of days a key can live before marked as needing to be deleted

### EMAIL_TO

The email address to send the email to

### EMAIL_FROM

The email address the email is sent as

### EMAIL_REPLY_TO

The email address to reply to (helpful when clicking REPLY ALL)

## Deployment

The application is (currently) deployed to the us-east1 Kubernetes cluster and is done manually for now.

The secrets and cronjob configuration can be found in the `kube` repo at: `<kube repo root>/us-east1.buffer-k8s.com/internal/aws-key-auditor`

### Deploying aws-key-auditor

_NOTE_: all scripts are run in the `aws-key-auditor` directory in the `kube` repo.

First make sure the secret containing the .env file is created

```sh
./create-secret.sh
```

Apply the cronjob deployment to kuberenetes

```sh
kubectl apply -f cronjob.yaml
```

### Updating the aws-key-auditor version

_Make changes to code, commit and push_

Get the latest git hash

```sh
git rev-parse HEAD
```

Publish with the latest git hash as the version

```
./publish.sh <the git hash>
```

Update version in the `kube` repo

```sh
cd <kube repo root>/us-east1.buffer-k8s.com/internal/aws-key-auditor
edit cronjob.yaml
```

Update the image version

```
image: bufferapp/aws-key-auditor:<the git hash>
```

Deploy the version

```sh
kubectl apply -f cronjob.yaml
```

### Updating environment variables

Open the environment variables in the `kube` repo

```sh
cd <kube repo root>/us-east1.buffer-k8s.com/internal/aws-key-auditor
edit env
```

_change the environment variables_

Update the environment variables secret

```sh
./create-secret.sh
```
