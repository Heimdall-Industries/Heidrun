const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory");
const readlineModule = require("readline");
const args = require("minimist")(
  process.argv.filter((val) => val.includes("="))
);

const Write = require("./lib/write");
const Web3 = require("./lib/web3");
const Nfts = require("./lib/nfts");
const {createHarvestInstruction} = require("@staratlas/factory/dist/score");
const {PublicKey} = require("@solana/web3.js");
const {ShipStakingInfo} = require("@staratlas/factory");
const {
  connection,
  resourceAddresses,
  scoreProgramId,
  keypair,
  resourceAvailability,
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

function calculatePercentLeft(fleetResourceBurnOutTime, shipTimeToBurnOneResource, currentCapacityTimestamp, shipResourceMaxReserve, currentTimeSec) {
  const fleetResourceCapacity = fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000)
  const resourcesLeft = fleetResourceCapacity - (currentTimeSec - currentCapacityTimestamp) / (shipTimeToBurnOneResource / 1000)
  return resourcesLeft / ((shipResourceMaxReserve) / 100)
}

let runningProcess;

async function start() {
  console.clear();
  Write.printLine([
    { text: "STAR ATLAS AUTOMATION", color: Write.colors.fgYellow },
    { text: " (press q to quit)", color: Write.colors.fgRed },
  ]);
  const triggerPercentage = 1;
  Write.printCheckTime();
  const nowSec = new Date().getTime() / 1000;
  await Web3.refreshAccountInfo();

  let activeFleets = [];
  await atlas
    .getAllFleetsForUserPublicKey(connection, userPublicKey, scoreProgramId)
    .then(
      async (stakingFleet) => {
        activeFleets = stakingFleet;

        // for (const fleet of stakingFleet) {
        //   const { shipMint, shipQuantityInEscrow } = fleet;
        //   const { millisecondsToBurnOneToolkit, millisecondsToBurnOneFuel, millisecondsToBurnOneFood, millisecondsToBurnOneArms} = await atlas.getScoreVarsShipInfo(
        //       connection,
        //       scoreProgramId,
        //       fleet.shipMint
        //   );
        //   let needTransaction = false;
        //
        //   activeFleets.push({
        //     name: Nfts[shipMint]?.name || Nfts[shipMint],
        //     tool: {
        //       label: 'HEALTH',
        //       percentage: 0,
        //       burnRate: millisecondsToBurnOneToolkit * shipQuantityInEscrow,
        //     },
        //     fuel: {
        //       label: 'FUEL',
        //       percentage: 0,
        //       burnRate: millisecondsToBurnOneFuel * shipQuantityInEscrow,
        //     },
        //     food: {
        //       label: 'FOOD',
        //       percentage: 0,
        //       burnRate: millisecondsToBurnOneFood * shipQuantityInEscrow,
        //     },
        //     arms: {
        //       label: 'AMMO',
        //       percentage: 0,
        //       burnRate: millisecondsToBurnOneArms * shipQuantityInEscrow,
        //     }
        //   })
        // }
      },
      () => {
        Write.printLine({ text: "Error.", color: Write.colors.fgRed });
        exitProcess();
      }
    );

  let burnRates = {
    tool: 0,
    fuel: 0,
    food: 0,
    arms: 0,
  };
  Write.printAvailableSupply(resourceAvailability);

  const transactionFleet = [];
  for (const fleet of activeFleets) {
    let needTransaction = false;

    Write.printLine({
      text: `\n------------------------`,
    });
    const shipName = Nfts[fleet.shipMint]?.name || Nfts[fleet.shipMint];
    Write.printLine({
      text: `| ${shipName} (${
        fleet.shipQuantityInEscrow
      }) |`,
    });
    Write.printLine({
      text: `------------------------`,
    });
    const shipInfo = await atlas.getScoreVarsShipInfo(
      connection,
      scoreProgramId,
      fleet.shipMint
    );

    const healthPercent = calculatePercentLeft(
        fleet.healthCurrentCapacity,
        shipInfo.millisecondsToBurnOneToolkit,
        fleet.currentCapacityTimestamp,
        shipInfo.toolkitMaxReserve,
        nowSec,
    );

    Write.printPercent(healthPercent, "HEALTH");
    if (healthPercent <= triggerPercentage) needTransaction = true;

    const fuelPercent = calculatePercentLeft(
        fleet.fuelCurrentCapacity,
        shipInfo.millisecondsToBurnOneFuel,
        fleet.currentCapacityTimestamp,
        shipInfo.fuelMaxReserve,
        nowSec,
    );

    Write.printPercent(fuelPercent, "FUEL");
    if (fuelPercent <= triggerPercentage) needTransaction = true;

    const foodPercent = calculatePercentLeft(
        fleet.foodCurrentCapacity,
        shipInfo.millisecondsToBurnOneFood,
        fleet.currentCapacityTimestamp,
        shipInfo.foodMaxReserve,
        nowSec,
    );

    Write.printPercent(foodPercent, "FOOD");
    if (foodPercent <= triggerPercentage) needTransaction = true;

    const armsPercent = calculatePercentLeft(
        fleet.armsCurrentCapacity,
        shipInfo.millisecondsToBurnOneArms,
        fleet.currentCapacityTimestamp,
        shipInfo.armsMaxReserve,
        nowSec,
    );

    Write.printPercent(armsPercent, "ARMS");
    if (armsPercent <= triggerPercentage) needTransaction = true;

    if (needTransaction) {
      transactionFleet.push({
        fleet: fleet,
        shipInfo: shipInfo,
      });
    }

    if(shipName === 'Pearce X4') {
      console.log('TEST SETTLE / CLAIM ATLAS');

      const txInstructions = [];

      // CLAIM ATLAS
      //   txInstructions.push(await atlas.createHarvestInstruction(
      //       connection,
      //       userPublicKey,
      //       new PublicKey(Web3.atlasTokenMint),
      //       new PublicKey(fleet.shipMint),
      //       scoreProgramId
      //   ));

      // BUY FOOD

      if(!!txInstructions.length) {
        await sendTransactions(txInstructions).then(async () => {
          Write.printLine({ text: "\n  DID SHIT, RIGHT?" });
        });
      }

    }

    Write.printLine({
      text: `------------------------`,
    });
  }




  if (transactionFleet.length > 0) {
    for (const { fleet, shipInfo } of transactionFleet) {
      Write.printLine({
        text: `\n ### Refilling ${
          Nfts[fleet.shipMint]?.name || Nfts[fleet.shipMint]
        } ###`,
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
  if ( character.toString() === "i") {
    return Write.printAvailableSupply(resourceAvailability);
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
