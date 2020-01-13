const got    = require("got");
const chalk  = require('chalk');
const os     = require('os');
const yargs  = require('yargs');
const retry  = require('async-retry');
const AWS    = require('aws-sdk');
const uuid   = require('uuid');
const util   = require('util');

class DigitalOceanProvider {

    constructor(token) {
        // Configure our headers to use our token when making REST api requests.
        this.headers = {
            'Content-Type':'application/json',
            Authorization: 'Bearer ' + token
        };
    }

    async makeRequest(url) {
        var resp = await got(url, { headers: this.headers, json:true })
            .catch(err => console.error(`${url} ${err}`));
        return resp;
    }

    async findSSHKeyPair(name) {
        var resp = await this.makeRequest('https://api.digitalocean.com/v2/account/keys');

        if (resp && resp.body && resp.body.ssh_keys) {
            var sshKey = resp.body.ssh_keys.find(key => key.name === name);
            if (sshKey) {
                return sshKey.id;
            }
        }

        throw new Error(`Unable to find SSH key pair: ${name}`);
    }

    async createDroplet(dropletName, region, imageName, sshKeyPairName) {
        if (dropletName == "" || region == "" || imageName == "" || sshKeyPairName == "") {
            console.log( chalk.red("You must provide non-empty parameters for createDroplet!") );
            return;
        }

        var sshKeyId = await this.findSSHKeyPair(sshKeyPairName);

        var data = {
            "name": dropletName,
            "region":region,
            "size":"512mb",
            "image":imageName,
            "ssh_keys": [sshKeyId],
            "backups":false,
            "ipv6":false,
            "user_data":null,
            "private_networking":null
        };

        console.log("Attempting to create: "+ JSON.stringify(data) );

        let response = await got.post("https://api.digitalocean.com/v2/droplets", {
            headers: this.headers,
            json:true,
            body: data
        }).catch(err => 
            console.error(chalk.red(`createDroplet: ${err}`)) 
        );

        if (response && response.statusCode == 202) {
            console.log(chalk.green(`Created droplet id ${response.body.droplet.id}`));
        }

        return response;
    }

    async dropletInfo(id) {
        if (typeof id != "number") {
            console.log( chalk.red("You must provide an integer id for your droplet!") );
            return;
        }

        return await this.makeRequest(`https://api.digitalocean.com/v2/droplets/${id}`);
    }

    async deleteDroplet(id) {
        if (typeof id != "number") {
            console.log( chalk.red("You must provide an integer id for your droplet!") );
            return;
        }

        let response = await got.delete(`https://api.digitalocean.com/v2/droplets/${id}`, {
            headers: this.headers,
            json:true
        }).catch(err => 
            console.error(chalk.red(`deleteDroplet: ${err}`)) 
        );

        if (!response) return;

        // No response body will be sent back, but the response code will indicate success.
        // Specifically, the response code will be a 204, which means that the action was successful with no returned body data.
        if (response.statusCode == 204) {
            console.log(`Deleted droplet ${id}`);
        }
    }
};

class AWSProvider {

    /**
     * Starts the provisioning of an AWS EC2 compute instance.
     * 
     * @param {string} name 
     * @param {string} region 
     * @param {string} imageName 
     * @param {string} sshKeyPairName 
     */
    async createInstance(name, region, imageName, sshKeyPairName) {
        var ec2 = new AWS.EC2();

        var instanceParams = {
            ImageId: imageName, 
            InstanceType: 't2.micro',
            KeyName: sshKeyPairName,
            MinCount: 1,
            MaxCount: 1
        };

        var resp = await ec2.runInstances(instanceParams).promise();
        var instanceId = resp.Instances[0].InstanceId;

        // Tag instance to set name
        var tagParams = {
            Resources: [ instanceId ],
            Tags: [
                {
                    Key: 'Name',
                    Value: name
                }
            ]
        }

        await ec2.createTags(tagParams).promise();
        return await this.instanceInfo(instanceId);
    }

    /**
     * Returns the properties of the AWS EC2 instance with the specified id
     * 
     * @param {string} id 
     */
    async instanceInfo(id) {
        var ec2 = new AWS.EC2();

        var params = {
            "InstanceIds": [ id ]
        }

        var resp = await ec2.describeInstances(params).promise();
        return resp.Reservations[0].Instances[0];
    }

    /**
     * Terminates the AWS EC2 compute instance with the specified id
     * 
     * @param {string} id 
     */
    async deleteInstance(id) {
        var ec2 = new AWS.EC2();

        var params = {
            "InstanceIds": [ id ]
        }

        var resp = await ec2.terminateInstances(params).promise();

        // Poll until instance is stopped or terminated
        console.log("Waiting for termination...");
        await retry(async bail => {
            var resp = await ec2.terminateInstances(params).promise();

            // States sufficient to demonstrate that the VM is no longer running
            var terminalStates = [ "stopped", "terminated" ];
            var currentState = resp.TerminatingInstances[0].CurrentState.Name;

            if (terminalStates.includes(currentState)) {
                return currentState;
            }

            throw new Error('Still waiting for termination...');
        }, {
            retries: 50,
            minTimeout: 1000,
            maxTimeout: 3000
        });

        return resp;
    }
}


/**
 * Validates that the DigitalOcean token is configured through the NCSU_DOTOKEN
 * environment variable.
 * 
 */
async function validateDigitalOceanToken() {
    var token = process.env.NCSU_DOTOKEN;

    if (!token) {
        console.log(chalk`{red.bold NCSU_DOTOKEN is not defined!}`);
        console.log(`Please set your environment variables with appropriate token.`);
        console.log(chalk`{italic You may need to refresh your shell in order for your changes to take place.}`);
        process.exit(1);
    }

    return token;
}

async function provisionDigitalOceanDroplet() {
    var token = await validateDigitalOceanToken();
    let client = new DigitalOceanProvider(token);

    var name = "jwmanes2-" + uuid.v4();
    var region = "nyc1"; 
    var image = "ubuntu-19-10-x64";
    var sshKeyPairName = "csc519";
    
    var createDropletResponse = await client.createDroplet(name, region, image, sshKeyPairName);

    if (createDropletResponse && createDropletResponse.body.droplet) {
        var dropletId = createDropletResponse.body.droplet.id;

        // Poll until an IPv4 address has been assigned
        await retry(async bail => {
            var resp = await client.dropletInfo(dropletId);

            if (resp && resp.body.droplet) {
                let droplet = resp.body.droplet;
                if (droplet.networks && droplet.networks.v4 && droplet.networks.v4.length > 0) {
                    // Print out IP address
                    console.log("IP:", droplet.networks.v4[0].ip_address);
                    return droplet.networks.v4[0].ip_address;
                }
            }

            throw new Error('Droplet networking not ready...');
        }, {
            retries: 10,
            minTimeout: 3000
        });
    }
}

async function destroyDigitalOceanDroplet(id) {
    var token = await validateDigitalOceanToken();
    let client = new DigitalOceanProvider(token);
    await client.deleteDroplet(id);
}

async function provisionAWSInstance() {
    console.log("Creating AWS instance...");
    let client = new AWSProvider();

    var name = "jwmanes2-" + uuid.v4();
    var region = "us-east-1"; 
    var image = "ami-0b6b1f8f449568786"; // Ubuntu 19.10 in us-east-1
    var sshKeyPairName = "csc519";

    var instance = await client.createInstance(name, region, image, sshKeyPairName);
    var instanceId = instance.InstanceId;
    console.log(`Instance ID: ${instanceId}`);

    // Poll until an IPv4 address has been assigned
    console.log("Waiting for IP address...");
    await retry(async bail => {
        var info = await client.instanceInfo(instanceId);

        if (info.PublicIpAddress) {
            // Print out IP address
            console.log('IP:', info.PublicIpAddress);
            return info.PublicIpAddress;
        }

        throw new Error('Instance networking not ready...');
    }, {
        retries: 10,
        minTimeout: 3000
    });
}

async function destroyAWSInstance(id) {
    console.log(`Deleting AWS instance ${id}`);
    var client = new AWSProvider();
    await client.deleteInstance(id);
}

yargs
    .scriptName("hw0")
    .usage('$0 <cmd> [args]')
    .command('create <provider>', 'Provision a new compute instance', 
        (yargs) => {
            yargs.positional('provider', {
                describe: 'Compute Provider key',
                choices: ['digitalocean', 'aws']
            });
        }, 
        async (argv) => {
            switch (argv.provider) {
                case 'digitalocean':
                    await provisionDigitalOceanDroplet();
                    break;
                case 'aws':
                    await provisionAWSInstance();
                    break;
            }
        })
    .command('rm <provider> <id>', 'Destroy a compute instance', 
        (yargs) => {
            yargs.positional('provider', {
                describe: 'Compute Provider key',
                choices: ['digitalocean', 'aws']
            }).positional('id', {
                describe: 'Instance id'
            });
        }, 
        async (argv) => {
            switch (argv.provider) {
                case 'digitalocean': 
                    await destroyDigitalOceanDroplet(argv.id);
                    break;
                case 'aws':
                    await destroyAWSInstance(argv.id);
                    break;
            }
        })
    .fail((msg, err) => {
        console.error(err);
    })
    .demandCommand()
    .help()
    .argv;
