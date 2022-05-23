const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory/dist/score");
const readlineModule = require("readline");
const args = require("minimist")(
  process.argv.filter((val) => val.includes("="))
);

const Write = require("./lib/write");
const Web3 = require("./lib/web3");
const { connection, resourceAddresses, scoreProgramId, keypair, nftNames } =
  Web3;

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

const calculatePercentLeft = (
    maxReserve,
    millisecondsToBurnOne,
    shipQuantityInEscrow,
    currentCapacityTimestamp,
    now,
    type
) => {
  // console.log(type);
  const totalMax = maxReserve * shipQuantityInEscrow;
  // console.log('totalMax', totalMax)
  const totalConsumed =
      (((now - currentCapacityTimestamp) * 1000) / millisecondsToBurnOne) *
      shipQuantityInEscrow;
  // console.log('totalConsumed', totalConsumed)
  console.log('1 left: ', (100 / totalMax) * (totalMax - totalConsumed))
  return (100 / totalMax) * (totalMax - totalConsumed);
};

const calculatePercentLeft2 = (
    maxReserve,
    millisecondsToBurnOne,
    shipQuantityInEscrow,
    currentTimeUntilEmpty,
    lastUpdateTimestamp,
    nowTimestamp,
    type
) => {
  const totalMax = maxReserve * shipQuantityInEscrow;
  const difference = nowTimestamp - lastUpdateTimestamp;
  const totalLeft = ((currentTimeUntilEmpty - difference) * 1000) / millisecondsToBurnOne *
      shipQuantityInEscrow;
  const totalConsumed =
      (((nowTimestamp - currentTimeUntilEmpty) * 1000) / millisecondsToBurnOne) *
      shipQuantityInEscrow;
  console.log('2 left: ', (100 / totalMax) * totalLeft)
  return (100 / totalMax) * (totalMax - totalConsumed);
};

let runningProcess;
async function start() {
  // console.clear();
  Write.printLine([
    { text: "STAR ATLAS AUTOMATION", color: Write.colors.fgYellow },
    { text: " (press q to quit)", color: Write.colors.fgRed },
  ]);
  const triggerPercentage = 1;
  Write.printCheckTime();
  const nowSec = new Date().getTime() / 1000;
  await Web3.refreshAccountInfo();

  let activeFleets;
  await atlas
    .getAllFleetsForUserPublicKey(connection, userPublicKey, scoreProgramId)
    .then(
      (fleet) => (activeFleets = fleet),
      () => {
        Write.printLine({ text: "Error.", color: Write.colors.fgRed });
        exitProcess();
      }
    );

  const transactionFleet = [];
  for (const fleet of activeFleets) {
    let needTransaction = false;

    Write.printLine({
      text: `\n------------------------`,
    });
    Write.printLine({
      text: `| ${nftNames[fleet.shipMint]} (${fleet.shipQuantityInEscrow}) |`,
    });
    console.log(new Date(fleet.currentCapacityTimestamp * 1000))
    Write.printLine({
      text: `------------------------`,
    });
    let shipInfo = await atlas.getScoreVarsShipInfo(
      connection,
      scoreProgramId,
      fleet.shipMint
    );
    const healthPercent = calculatePercentLeft(
        shipInfo.toolkitMaxReserve,
        shipInfo.millisecondsToBurnOneToolkit,
        fleet.shipQuantityInEscrow,
        fleet.repairedAtTimestamp,
        nowSec,
        'health'
    );
    const healthPercent2 = calculatePercentLeft2(
        shipInfo.toolkitMaxReserve,
        shipInfo.millisecondsToBurnOneToolkit,
        fleet.shipQuantityInEscrow,
        fleet.healthCurrentCapacity,
        fleet.repairedAtTimestamp,
        nowSec,
        'health'
    );
    Write.printPercent(healthPercent, "HEALTH");
    if (healthPercent <= triggerPercentage) needTransaction = true;

    const fuelPercent = calculatePercentLeft(
      shipInfo.fuelMaxReserve,
      shipInfo.millisecondsToBurnOneFuel,
      fleet.shipQuantityInEscrow,
      fleet.fueledAtTimestamp,
      nowSec,
        'fuel'
    );
    const fuelPercent2 = calculatePercentLeft2(
        shipInfo.fuelMaxReserve,
        shipInfo.millisecondsToBurnOneFuel,
        fleet.shipQuantityInEscrow,
        fleet.fuelCurrentCapacity,
        fleet.fueledAtTimestamp,
        nowSec,
        'fuel'
    );
    Write.printPercent(fuelPercent, "FUEL");
    if (fuelPercent <= triggerPercentage) needTransaction = true;

    const foodPercent = calculatePercentLeft(
        shipInfo.foodMaxReserve,
        shipInfo.millisecondsToBurnOneFood,
        fleet.shipQuantityInEscrow,
        fleet.fedAtTimestamp,
        nowSec,
        'food'
    );
    const foodPercent2 = calculatePercentLeft2(
        shipInfo.foodMaxReserve,
        shipInfo.millisecondsToBurnOneFood,
        fleet.shipQuantityInEscrow,
        fleet.foodCurrentCapacity,
        fleet.fedAtTimestamp,
        nowSec,
        'food'
    );
    Write.printPercent(foodPercent, "FOOD");
    if (foodPercent <= triggerPercentage) needTransaction = true;

    const armsPercent = calculatePercentLeft(
        shipInfo.armsMaxReserve,
        shipInfo.millisecondsToBurnOneArms,
        fleet.shipQuantityInEscrow,
        fleet.armedAtTimestamp,
        nowSec,
        'arms'
    );
    const armsPercent2 = calculatePercentLeft2(
        shipInfo.armsMaxReserve,
        shipInfo.millisecondsToBurnOneArms,
        fleet.shipQuantityInEscrow,
        fleet.armsCurrentCapacity,
        fleet.armedAtTimestamp,
        nowSec,
        'arms'
    );
    Write.printPercent(armsPercent, "ARMS");
    if (armsPercent <= triggerPercentage) needTransaction = true;

    if (needTransaction) {
      transactionFleet.push({
        fleet: fleet,
        shipInfo: shipInfo,
      });
    }

    Write.printLine({
      text: `------------------------`,
    });
  }

  if (transactionFleet.length > 0) {
    for (const { fleet, shipInfo } of transactionFleet) {
      Write.printLine({
        text: `\n ### Refilling ${nftNames[fleet.shipMint]} ###`,
      });

      const txInstructions = [];
      for (const resource of Object.keys(resourceAddresses)) {
        txInstructions.push(await getTxInstruction(resource, shipInfo, fleet));
      }

      await sendTransactions(txInstructions).then(async () => {
        Write.printLine({ text: "\n  Resources refilled successfully" });
      });
    }
  } else {
    Write.printLine({ text: "\n  No need to refill fleet." });
  }
}

const exitProcess = () => {
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
process.stdin.setRawMode(true);
process.stdin.on("keypress", (character) => {
  if (character.toString() === "q") {
    return exitProcess();
  }
  return false;
});

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

      Write.printLine({
        text:
          "Repeating process every " + intervalTime / 60000 + " minute(s).\n",
        color: Write.colors.fgYellow,
      });

      runningProcess = setInterval(start, intervalTime);
    } else {
      process.exit(0);
    }
  })
  .catch((err) => console.error(err));
