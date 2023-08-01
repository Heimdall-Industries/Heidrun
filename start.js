const readlineModule = require("readline");
const args = require("minimist")(process.argv.slice(2));

const Write = require("./lib/write");
const Web3 = require("./lib/web3");
const Harvest = require("./lib/harvest");
const Score = require("./lib/score");

const { connection, keypair } = Web3;

const harvestInstructions = new Harvest({ connection, keypair });
const scoreInstructions = new Score({ connection, keypair });
const minimumIntervalTime = 600000;
const maximumIntervalTime = 6000000;
let intervalTime = 0;
let nowSec;

let runningProcess;

async function start(isFirst = false) {
  if (isFirst) {
    Write.printLogo();
    await scoreInstructions.getStarAtlasNftInformation();
  }

  nowSec = new Date().getTime() / 1000;
  Write.printLine([
    { text: " Fetching latest flight data...", color: Write.colors.fgYellow },
  ]);

  if (!!scoreInstructions.autoBuyFleet) {
    Write.printLine({
      text: ` Auto buy enabled for ${scoreInstructions.autoBuyFleet.name}.`,
      color: Write.colors.fgYellow,
    });
  }

  await scoreInstructions.refreshStakingFleet();
  await scoreInstructions.refreshInventory();
  Write.printAvailableSupply(scoreInstructions.inventory);
  await scoreInstructions.showFleet();
  const claimStakeInventory = await harvestInstructions.harvestAll();
  if (claimStakeInventory.length) {
    Write.printClaimStakesInformation(claimStakeInventory);
  } else {
    Write.printLine({
      text: ` ${"-".repeat(63)}`,
    });
  }
  await scoreInstructions.refillFleet();
  Write.printDailyChurn(
    scoreInstructions.dailyUsage,
    harvestInstructions.dailyGeneration,
  );

  intervalTime =
    args.interval && args.interval > minimumIntervalTime
      ? args.interval < maximumIntervalTime
        ? args.interval
        : maximumIntervalTime
      : minimumIntervalTime;

  Write.printRefreshInformation(intervalTime);
}

const exitProcess = async () => {
  Write.printLine({
    text: "\n Button 'q' pressed",
    color: Write.colors.fgYellow,
  });
  Write.printLine({
    text: "Stopping STAR ATLAS AUTOMATION.",
    color: Write.colors.fgYellow,
  });
  clearInterval(runningProcess);
  process.exit(0);
};

readlineModule.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.on("keypress", (character) => {
  if (character?.toString() === "q") {
    return exitProcess();
  }
  if (character?.toString() === "b") {
    if (!!scoreInstructions.autoBuyFleet) {
      Write.printLine({
        text: "Starting auto buy process.",
        color: Write.colors.fgYellow,
      });
      return scoreInstructions
        .processAutoBuy(scoreInstructions.autoBuyFleet)
        .then(() => {
          Write.printLine({
            text: "Auto buy process finished.",
            color: Write.colors.fgYellow,
          });
        });
    } else {
      Write.printLine({
        text: "Auto buy not enabled.",
        color: Write.colors.fgRed,
      });
    }
  }
  if (character?.toString() === "c") {
    Write.printLine({
      text: "Starting claim ATLAS process.",
      color: Write.colors.fgYellow,
    });
    return scoreInstructions.claimAtlas().then(() => {
      Write.printLine({
        text: "Claim ATLAS process finished.",
        color: Write.colors.fgYellow,
      });
    });
  }
  if (character?.toString() === "i") {
    return Write.printAvailableSupply(scoreInstructions.inventory, true);
  }
  return false;
});

const startInterval = async () => {
  if (args.noRunningProcess !== "true") {
    clearInterval(runningProcess);
    runningProcess = setInterval(start, intervalTime);
  } else {
    process.exit(0);
  }
};

start(true)
  .then(startInterval)
  .catch((err) => console.error(err));
