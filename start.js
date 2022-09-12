const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory");
const readlineModule = require("readline");
const args = require("minimist")(
  process.argv.filter((val) => val.includes("="))
);
const Write = require("./lib/write");
const Web3 = require("./lib/web3");
const { GmClientService} = require('@staratlas/factory');
const {PublicKey} = require("@solana/web3.js");
const {
  connection,
  resourceAddresses,
  scoreProgramId,
  keypair,
  resourceAvailability,
    traderProgramId,
    traderOwnerId,
  getNftInformation,
} = Web3;

const triggerPercentage = 10;
const orderForDays = 1;
const userPublicKey = keypair.publicKey;
const millisecondsInDay = 86100000;
let perDay = {
  fuel: [],
  food: [],
  arms: [],
  toolkit: [],
}

const getTxInstruction = async (type, shipInfo, fleet) => {
  const {
    createRefeedInstruction,
    createRearmInstruction,
    createRefuelInstruction,
    createRepairInstruction,
  } = atlas;
  let createInstruction;
  switch (type) {
    case "arms":
      createInstruction = createRearmInstruction;
      break;
    case "food":
      createInstruction = createRefeedInstruction;
      break;
    case "fuel":
      createInstruction = createRefuelInstruction;
      break;
    case "toolkit":
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

const getResourcesLeft = (fleetResourceBurnOutTime, shipTimeToBurnOneResource, currentCapacityTimestamp, currentTimeSec) => {
  const fleetResourceCapacity = fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000)
  return fleetResourceCapacity - (currentTimeSec - currentCapacityTimestamp) / (shipTimeToBurnOneResource / 1000);
}

function calculatePercentLeft(fleetResourceBurnOutTime, shipTimeToBurnOneResource, currentCapacityTimestamp, shipResourceMaxReserve, currentTimeSec) {
  const resourcesLeft = getResourcesLeft(fleetResourceBurnOutTime, shipTimeToBurnOneResource, currentCapacityTimestamp, currentTimeSec)
  return resourcesLeft / ((shipResourceMaxReserve) / 100)
}

let runningProcess;
const gmClientService = new GmClientService();

async function claimAtlas(activeFleets) {
  const txInstructions = [];

  for (const fleet of activeFleets) {

    txInstructions.push(await atlas.createHarvestInstruction(
        connection,
        userPublicKey,
        new PublicKey(Web3.atlasTokenMint),
        fleet.shipMint,
        scoreProgramId
    ));
  }
  if(!!txInstructions.length) {
    return await connection.sendTransaction(new web3.Transaction().add(...txInstructions), [keypair]);
  }

  return Promise.resolve(false);
}

async function orderResources(nftInformation) {
  const orders = await gmClientService.getOpenOrdersForPlayer(connection, new PublicKey(traderOwnerId), traderProgramId)
  await Promise.allSettled(orders.map(async (order) => {
    const resource = nftInformation.find(nft => {
      return nft.mint === order.orderMint
    });
    const resourceName = resource.name === 'Ammunition' ? 'Arms' : resource.name;

    return  await connection.sendTransaction(new web3.Transaction().add((await gmClientService.getCreateExchangeTransaction(
        connection,
        order,
        userPublicKey,
        perDay[resourceName.toLowerCase()].reduce((partialSum, a) => partialSum + a, 0) * orderForDays,
        traderProgramId,
    )).transaction), [keypair]).then(async () => {
      Write.printLine({text: "\n  ORDER COMPLETED: " + resource.name});
    });
  }));
}

const haveEnoughResources = ({ fleet, shipInfo }, nowSec) => {
  let enoughResources = true;
  for (const resource of Object.keys(resourceAddresses)) {
    const shipAmount = fleet.shipQuantityInEscrow;
    const fleetResource = resource === 'toolkit' ? 'health' : resource;
    const left = getResourcesLeft(
        fleet[`${fleetResource}CurrentCapacity`],
        shipInfo[`millisecondsToBurnOne${resource.charAt(0).toUpperCase() + resource.slice(1)}`],
        fleet.currentCapacityTimestamp,
        nowSec,
    );

    const max = shipInfo[`${resource}MaxReserve`] * shipAmount;
    const current = left * shipAmount;
    const needed = max - current;
    if(resourceAvailability[resource] < needed) {
      enoughResources = false;
    }
  }

  return Promise.resolve(enoughResources);
}

const refillResources = async ({ fleet, shipInfo }) => {
  const txInstructions = [];

  for (const resource of Object.keys(resourceAddresses)) {
    const instruction = await getTxInstruction(resource, shipInfo, fleet);
    txInstructions.push(instruction);
  }

  return await sendTransactions(txInstructions);
}

async function start() {
  console.clear();
  Write.printLine([
    { text: "STAR ATLAS AUTOMATION", color: Write.colors.fgYellow },
    { text: " (press q to quit)", color: Write.colors.fgRed },
  ]);

  perDay = {
    fuel: [],
    food: [],
    arms: [],
    toolkit: [],
  }
  Write.printCheckTime();
  const nowSec = new Date().getTime() / 1000;
  Write.printLine([
    { text: "Recovering NFT information", color: Write.colors.fgWhite },
  ]);
  const nftInformation = (await getNftInformation()).filter(nft => nft.attributes.itemType === 'ship' || nft.attributes.itemType === 'resource');
  await Web3.refreshAccountInfo();

  let activeFleets = [];
  await atlas
    .getAllFleetsForUserPublicKey(connection, userPublicKey, scoreProgramId)
    .then(
      async (stakingFleet) => activeFleets = stakingFleet,
      () => {
        Write.printLine({ text: "Error.", color: Write.colors.fgRed });
        exitProcess();
      }
    );
  Write.printAvailableSupply(resourceAvailability);

  const transactionFleet = [];
  for (const fleet of activeFleets) {
    let needTransaction = false;

    Write.printLine({
      text: `\n------------------------`,
    });
    const nft = nftInformation.find(nft => {
      return nft.mint === fleet.shipMint.toString()
    });
    Write.printLine({
      text: `| ${nft.name} (${
        fleet.shipQuantityInEscrow
      }) |`,
    });
    Write.printLine({
      text: `------------------------`,
    });
    const shipInfo = await atlas.getScoreVarsShipInfo(
      connection,
      scoreProgramId,
      new web3.PublicKey(nft.mint)
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
    if (armsPercent <= triggerPercentage) {
      needTransaction = true;
    }

    if (needTransaction) {
      transactionFleet.push({
        fleet,
        shipInfo,
        nft
      });
    }

    const calculateDailyUsage = (millisecondsForOne) => (millisecondsInDay / millisecondsForOne) * fleet.shipQuantityInEscrow
    const { millisecondsToBurnOneFuel, millisecondsToBurnOneArms, millisecondsToBurnOneFood, millisecondsToBurnOneToolkit } = shipInfo;
    perDay.fuel.push(calculateDailyUsage(millisecondsToBurnOneFuel));
    perDay.food.push(calculateDailyUsage(millisecondsToBurnOneFood));
    perDay.arms.push(calculateDailyUsage(millisecondsToBurnOneArms));
    perDay.toolkit.push(calculateDailyUsage(millisecondsToBurnOneToolkit));

    Write.printLine({
      text: `------------------------`,
    });
  }

  if (transactionFleet.length > 0) {
    for (const { fleet, shipInfo, nft } of transactionFleet) {
      Write.printLine({
        text: `\n ### Refilling ${
            nft.name
        } ###`,
      });

      const hasEnoughResources = await haveEnoughResources({ fleet, shipInfo }, nowSec);

      if(hasEnoughResources) {
        await refillResources({shipInfo, fleet}).then(async () => {
          Write.printLine({ text: "\n  Resources refilled successfully" });
        });
      } else {
        Write.printLine({ text: "\n  Not enough resources, claiming ATLAS" });
        await claimAtlas(activeFleets).then(async (result) => {
          if(!!result) {
            Write.printLine({ text: "\n  ATLAS claimed successfully, buying resources" });
            await orderResources(nftInformation).then( async () => {
              Write.printLine({ text: "\n  Resources bought, refilling" });
              await refillResources({shipInfo, fleet}).then(async () => {
                Write.printLine({ text: "\n  Resources refilled successfully" });
              });
            })
          }
        })

      }
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
  if (character?.toString() === "q") {
    return exitProcess();
  }
  if ( character?.toString() === "i") {
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
