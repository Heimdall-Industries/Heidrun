const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory/dist/score");
const readlineModule = require("readline");
const args = require("minimist")(
  process.argv.filter((val) => val.includes("="))
);

const { printPercent, printCheckTime, printLine} = require("./lib/write");
const Web3 = require("./lib/web3");
const {
  connection,
  resourceAddresses,
  scoreProgramId,
  keypair,
  nftNames,
  tokenProgramId,
} = Web3;


const userPublicKey = keypair.publicKey;

const getTxInstruction = async (type, shipInfo, fleet) => {
  const {
    createRefeedInstruction,
    createRearmInstruction,
    createRefuelInstruction,
    createRepairInstruction,
  } = atlas;
  let createInstruction;
  switch (type) {
    case "ammo":
      createInstruction = createRearmInstruction;
      break;
    case "food":
      createInstruction = createRefeedInstruction;
      break;
    case "fuel":
      createInstruction = createRefuelInstruction;
      break;
    case "tool":
      createInstruction = createRepairInstruction;
      break;
    default:
      return false;
  }

  return await createInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    shipInfo.foodMaxReserve * fleet.shipQuantityInEscrow,
    fleet.shipMint,
    new web3.PublicKey(resourceAddresses[type]),
      Web3.getTokenPublicKey(resourceAddresses[type]),
    scoreProgramId
  );
};

async function sendTransactions(txInstruction) {
  const tx = new web3.Transaction().add(...txInstruction);
  return await connection.sendTransaction(tx, [keypair]);
}

function calculatePercentLeft(
  fleetResourceBurnOutTime,
  shipTimeToBurnOneResource,
  currentCapacityTimestamp,
  shipResourceMaxReserve,
  currentTimeSec
) {
  const fleetResourceCapacity =
    fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000);
  const resourcesLeft =
    fleetResourceCapacity -
    (currentTimeSec - currentCapacityTimestamp) /
      (shipTimeToBurnOneResource / 1000);
  return resourcesLeft / (shipResourceMaxReserve / 100).toFixed(1);
}

let runningProcess;
async function start() {
  const triggerPercentage = 1;
  printCheckTime();
  const nowSec = new Date().getTime() / 1000;

  await Web3.refreshAccountInfo();

  printLine("\n  Loading fleet.");
  let userFleets;
  await atlas
    .getAllFleetsForUserPublicKey(connection, userPublicKey, scoreProgramId)
    .then(
      (fleet) => {
        userFleets = fleet;
        process.stdout.write("\033[92m  Success. \033[0m");
      },
      () => {
        process.stdout.write("\03391m  Error. \033[0m");
        exitProcess();
      }
    );

  const transactionFleet = [];
  for (const fleet of userFleets) {
    let needTransaction = false;

    process.stdout.write(
      `\n ${nftNames[fleet.shipMint]} (${fleet.shipQuantityInEscrow}) \n`
    );
    let shipInfo = await atlas.getScoreVarsShipInfo(
      connection,
      scoreProgramId,
      fleet.shipMint
    );

    const healthPercent = calculatePercentLeft(
      fleet.healthCurrentCapacity,
      shipInfo.millisecondsToBurnOneToolkit,
      fleet.currentCapacityTimestamp,
      shipInfo.toolkitMaxReserve,
      nowSec
    );
    printPercent(healthPercent, "HEALTH");
    if (healthPercent <= triggerPercentage) needTransaction = true;

    const fuelPercent = calculatePercentLeft(
      fleet.fuelCurrentCapacity,
      shipInfo.millisecondsToBurnOneFuel,
      fleet.currentCapacityTimestamp,
      shipInfo.fuelMaxReserve,
      nowSec
    );
    printPercent(fuelPercent, "FUEL");
    if (fuelPercent <= triggerPercentage) needTransaction = true;

    const foodPercent = calculatePercentLeft(
      fleet.foodCurrentCapacity,
      shipInfo.millisecondsToBurnOneFood,
      fleet.currentCapacityTimestamp,
      shipInfo.foodMaxReserve,
      nowSec
    );
    printPercent(foodPercent, "FOOD");
    if (foodPercent <= triggerPercentage) needTransaction = true;

    const armsPercent = calculatePercentLeft(
      fleet.armsCurrentCapacity,
      shipInfo.millisecondsToBurnOneArms,
      fleet.currentCapacityTimestamp,
      shipInfo.armsMaxReserve,
      nowSec
    );
    printPercent(armsPercent, "ARMS");
    if (armsPercent <= triggerPercentage) needTransaction = true;

    if (needTransaction) {
      transactionFleet.push({
        fleet: fleet,
        shipInfo: shipInfo,
      });
    }
  }

  if (transactionFleet.length > 0) {
    for (const { fleet, shipInfo } of transactionFleet) {
      process.stdout.write(
        `\n ### Refilling ${nftNames[fleet.shipMint]} ###\n`
      );

      const txInstructions = [];
      for (const resource of Object.keys(resourceAddresses)) {
        txInstructions.push(await getTxInstruction(resource, shipInfo, fleet));
      }

      await sendTransactions(txInstructions).then(async () => {
        process.stdout.write("\n  Resources refilled successfully\n");
      });
    }
  } else {
    process.stdout.write("\n  No need to refill fleet.\n");
  }
}

const exitProcess = () => {
  process.stdout.write("\n\033[91m Button 'q' pressed\033[0m\n");
  process.stdout.write("Stopping STAR ATLAS AUTOMATION.\n");
  clearInterval(runningProcess);
  process.exit(0);
};
readlineModule.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on("keypress", (character) => {
  if (character.toString() === "q") {
    return exitProcess();
  }
  return false;
});

process.stdout.write(
  "Starting STAR ATLAS AUTOMATION \033[91m(press q to quit)\033[0m\n"
);

start()
  .then(() => {
    if (args.noRunningProcess !== "true") {
      const minimumIntervalTime = 600000;
      const maximumIntervalTime = 6000000;
      const intervalTime =
        args.interval && args.interval > minimumIntervalTime
          ? args.interval < maximumIntervalTime
            ? args.interval
            : maximumIntervalTime
          : minimumIntervalTime;

      process.stdout.write(
        "\nRepeating process every " + intervalTime / 60000 + " minute(s).\n\n"
      );

      runningProcess = setInterval(start, intervalTime);
    } else {
      process.exit(0);
    }
  })
  .catch((err) => console.error(err));
