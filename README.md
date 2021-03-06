# HW0-DevOps

# Opunit validation
![opunit passed](https://github.ncsu.edu/jwmanes2/HW0-DevOps/raw/master/jwmanes2_opunit.png)


# Screencast Demo
https://drive.google.com/open?id=1tDkwrBW0tSbLM2TRYJPZXSk4i4Cb4UwY (Requires NCSU credentials)


# Prerequisites
1. Install NPM dependencies by running:

```
npm install
```
2. Obtain cloud provider API credentials. See the sections below for more information.

# DigitalOcean Instructions

## Provisioning a DigitalOcean droplet
1. Set the `NCSU_DOTOKEN` environment variable containing a DigitalOcean API key.
2. Run the following command to create a new DigitalOcean droplet. The ID and IP address
of the Droplet will be printed.

```
node hw0.js create digitalocean
```

## Deleting a DigitalOcean droplet
With the ID that was logged when the Droplet was created, you can delete the Droplet by running the following command:

```
node hw0.js rm digitalocean [id]
```

# AWS Instructions
## Provisioning an AWS EC2 Compute Instance
1. Configure AWS credentials according to https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html. For example, set the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables.

2. Run the following command to create a new AWS EC2 Compute Instance. The ID and IP address
of the instance will be printed.

```
node hw0.js create aws
```

## Terminating a AWS EC2 Compute Instance
With the ID that was logged when the instance was created, you can delete the instance by running the following command:

```
node hw0.js rm aws [id]
```


