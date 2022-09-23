# Heimðall Industries StarAtlas Automation

You need to have your private key in a file called information.json.
Be careful to whom can access your file.

run it using:
`node .\start.js`

## Step by step
First install the following:
 - [GIT](https://git-scm.com/downloads): You will need to install git to download this script. 
 - [Node](https://nodejs.org/en/download/): You will need to install node to be able to run this script.

To download and prepare the script do the following:
 - `git clone git@github.com:MartinGerritsen/staratlas-automation.git`
 - `cd startatlas-automation`
 - `npm install`

Then the final steps, remember to be careful with your private key!
 - Create the file `information.json` inside of the root directory and fill in your private key, you can check / copy / rename the example file `information.example.json`.
 - Back in the root directory now run `node .\start.js` and open Netflix!

There can be some unexpected errors sometimes, which will mean that you need to restart the script, but it works pretty nicely, enjoy!

## Optional information arguments:

The following arguments can be added to your own `information.json`:

 - autoBuy: place the ship mint address here to automatically buy this ship after the full claim Atlas, buy resources, resupply fleet.
 - autoStake: `true` or `false` to automatically stake ships found in your inventory.

## Optional arguments:

### Interval (600000 / 6000000)

`node start.js --interval=6000000`

### No Running Process (true / any)

`node start.js --noRunningProcess=true`