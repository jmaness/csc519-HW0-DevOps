const got    = require("got");
const chalk  = require('chalk');
const os     = require('os');
const yargs  = require('yargs');
const retry = require('async-retry')

var config = {};
// Retrieve our api token from the environment variables.
config.token = process.env.NCSU_DOTOKEN;

if( !config.token ) {
    console.log(chalk`{red.bold NCSU_DOTOKEN is not defined!}`);
    console.log(`Please set your environment variables with appropriate token.`);
    console.log(chalk`{italic You may need to refresh your shell in order for your changes to take place.}`);
    process.exit(1);
}

console.log(chalk.green(`Your token is: ${config.token.substring(0,4)}...`));

// Configure our headers to use our token when making REST api requests.
const headers = {
    'Content-Type':'application/json',
    Authorization: 'Bearer ' + config.token
};


class DigitalOceanProvider {
    async makeRequest(url) {
        let response = await got(url, { headers: headers, json:true })
                             .catch(err => console.error(`${url} ${err}`));
        
        if( !response ) return;

        if( response.headers ) {
            console.log( chalk.yellow(`Calls remaining ${response.headers["ratelimit-remaining"]}`) );
        }
        return response;
    }

    async createDroplet (dropletName, region, imageName, sshKeys ) {
        if( dropletName == "" || region == "" || imageName == "" ) {
            console.log( chalk.red("You must provide non-empty parameters for createDroplet!") );
            return;
        }

        var data = {
            "name": dropletName,
            "region":region,
            "size":"512mb",
            "image":imageName,
            "ssh_keys": sshKeys,
            "backups":false,
            "ipv6":false,
            "user_data":null,
            "private_networking":null
        };

        console.log("Attempting to create: "+ JSON.stringify(data) );

        let response = await got.post("https://api.digitalocean.com/v2/droplets", {
            headers:headers,
            json:true,
            body: data
        }).catch(err => 
            console.error(chalk.red(`createDroplet: ${err}`)) 
        );

        if (!response) return;

        console.log(response.statusCode);
        console.log(response.body);

        if(response.statusCode == 202) {
            console.log(chalk.green(`Created droplet id ${response.body.droplet.id}`));
        }

        return response;
    }

    async dropletInfo(id) {
        if (typeof id != "number") {
            console.log( chalk.red("You must provide an integer id for your droplet!") );
            return;
        }

        // Make REST request
        return await this.makeRequest(`https://api.digitalocean.com/v2/droplets/${id}`);
    }

    async deleteDroplet(id) {
        if (typeof id != "number") {
            console.log( chalk.red("You must provide an integer id for your droplet!") );
            return;
        }

        let response = await got.delete(`https://api.digitalocean.com/v2/droplets/${id}`, {
            headers:headers,
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

async function provisionDigitalOceanDroplet() {
    let client = new DigitalOceanProvider();

    var name = "jwmanes2-" + os.hostname();
    var region = "nyc1"; 
    var image = "ubuntu-19-10-x64";

    // Select the first SSH key configured in DigitalOcean which should be sufficient for HW0
    var sshKeyId = (await client.makeRequest('https://api.digitalocean.com/v2/account/keys'))
        .body.ssh_keys[0].id;
    
    var createDropletResponse = await client.createDroplet(name, region, image, [sshKeyId]);

    if (createDropletResponse && createDropletResponse.body.droplet) {
        var dropletId = createDropletResponse.body.droplet.id;

        // Poll until an IPv4 address has been assigned
        await retry(async bail => {
            var resp = await client.dropletInfo(dropletId);

            if (resp && resp.body.droplet) {
                let droplet = resp.body.droplet;
                if (droplet.networks && droplet.networks.v4 && droplet.networks.v4.length > 0) {
                    // Print out IP address
                    console.log(droplet.networks.v4[0].ip_address);
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
    let client = new DigitalOceanProvider();
    await client.deleteDroplet(id);
}

async function provisionAWSInstance() {
    console.log("Creating AWS instance...");
}

async function destroyAWSInstance(id) {
    console.log(`Deleting AWS instance ${id}`);
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
    .demandCommand()
    .help()
    .argv;
