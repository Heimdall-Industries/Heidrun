# Heimðall Industries Heiðrún StarAtlas Automation

Welcome to Heiðrún, our script to help you with staking your StarAtlas fleet!
 
Please follow this simple guide to start making your space adventures just a little easier.
## Step by step
First install the following:
 - [GIT](https://git-scm.com/downloads): You will need to install git to download this script. 
 - [Node](https://nodejs.org/en/download/): You will need to install node to be able to run this script.

To download and prepare the script do the following:
 - `git clone git@github.com:Heimdall-Industries/Heidrun.git`
 - `cd Heidrun`
 - `npm install`

Then the final steps, remember to be careful with your private key!
 - Create the file `.env` inside of the root directory and fill in your private key, you can check / copy / rename the example file `.env.example`.
 - Back in the root directory now run `node .\start.js` and open Netflix!

There can be some unexpected errors sometimes, which will mean that you need to restart the script, but it works pretty nicely, enjoy!

## Optional information arguments:

The following arguments can be added to your own `.env`:

 - AUTO_BUY: place the ship mint address here to automatically buy this ship after the full claim Atlas, buy resources, resupply fleet.
 - AUTO_STAKE: `true` or `false` to automatically stake ships found in your inventory.
- CUSTOM_RPC: The address of your personal rpc server.
- DISCORD_WEBHOOK: You can set up your own webhook to get refill and auto-stake reports, just copy-paste the unique code that comes after `https://discordapp.com/api/webhooks/`.
 - DONATION_OPT_OUT: `true` or `false` to opt out of donating 2% of claim Atlas transactions to the developers of this script.

## Optional arguments:

### Interval (600000 / 6000000)

`node start.js --interval=6000000`

### No Running Process (true / any)

`node start.js --noRunningProcess=true`

## Special thanks:

I would like to thank [Lu](https://github.com/mindrunner) and Xcode on the Star Atlas discord server for sharing their knowledge!
