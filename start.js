const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory");
const readlineModule = require("readline");
const args = require("minimist")(
  process.argv.filter((val) => val.includes("="))
);
const Write = require("./lib/write");
const Web3 = require("./lib/web3");
const { GmClientService } = require("@staratlas/factory");
const { PublicKey } = require("@solana/web3.js");
const {
  DECIMALS,
  autoBuy,
  autoStake,
  atlasTokenMint,
  connection,
  resourceAddresses,
  scoreProgramId,
  keypair,
  resourceAvailability,
  traderProgramId,
  traderOwnerId,
  nftInformation,
  nftShipInformation,
  nftResourceInformation,
  inventory,
  getNftInformation,
} = Web3;

let nftAutoBuyInformation;
let activeFleets = [];
const triggerPercentage = 1;
const orderForDays = 30;
const userPublicKey = keypair.publicKey;
const millisecondsInDay = 86100000;
const minimumIntervalTime = 600000;
const maximumIntervalTime = 6000000;
let intervalTime = 0;
let nowSec;
let perDay = {
  fuel: [],
  food: [],
  arms: [],
  toolkit: [],
};

const getResupplyInstruction = async (resource, shipInfo, fleet) => {
  const {
    createRefeedInstruction,
    createRearmInstruction,
    createRefuelInstruction,
    createRepairInstruction,
  } = atlas;
  let quantity;
  let createInstruction;

  switch (resource.name) {
    case "Ammunition":
      createInstruction = createRearmInstruction;
      quantity =
        (shipInfo.armsMaxReserve -
          getResourcesLeft(
            fleet.armsCurrentCapacity,
            shipInfo.millisecondsToBurnOneArms,
            fleet.currentCapacityTimestamp,
            nowSec
          )) *
        fleet.shipQuantityInEscrow;
      break;
    case "Food":
      createInstruction = createRefeedInstruction;
      quantity =
        (shipInfo.foodMaxReserve -
          getResourcesLeft(
            fleet.foodCurrentCapacity,
            shipInfo.millisecondsToBurnOneFood,
            fleet.currentCapacityTimestamp,
            nowSec
          )) *
        fleet.shipQuantityInEscrow;
      break;
    case "Fuel":
      createInstruction = createRefuelInstruction;
      quantity =
        (shipInfo.fuelMaxReserve -
          getResourcesLeft(
            fleet.fuelCurrentCapacity,
            shipInfo.millisecondsToBurnOneFuel,
            fleet.currentCapacityTimestamp,
            nowSec
          )) *
        fleet.shipQuantityInEscrow;
      break;
    case "Toolkit":
      createInstruction = createRepairInstruction;
      quantity =
        (shipInfo.toolkitMaxReserve -
          getResourcesLeft(
            fleet.healthCurrentCapacity,
            shipInfo.millisecondsToBurnOneToolkit,
            fleet.currentCapacityTimestamp,
            nowSec
          )) *
        fleet.shipQuantityInEscrow;
      break;
    default:
      return false;
  }

  return await createInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    quantity,
    fleet.shipMint,
    new PublicKey(resource.mint),
    new PublicKey(resource.tokenAccount),
    scoreProgramId
  );
};

async function sendTransactions(txInstruction) {
  const tx = new web3.Transaction().add(...txInstruction);
  return await connection.sendTransaction(tx, [keypair]);
}

const getResourcesLeft = (
  fleetResourceBurnOutTime,
  shipTimeToBurnOneResource,
  currentCapacityTimestamp,
  currentTimeSec
) => {
  const fleetResourceCapacity =
    fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000);
  return (
    fleetResourceCapacity -
    (currentTimeSec - currentCapacityTimestamp) /
      (shipTimeToBurnOneResource / 1000)
  );
};

function calculatePercentLeft(
  fleetResourceBurnOutTime,
  shipTimeToBurnOneResource,
  currentCapacityTimestamp,
  shipResourceMaxReserve,
  currentTimeSec
) {
  const resourcesLeft = getResourcesLeft(
    fleetResourceBurnOutTime,
    shipTimeToBurnOneResource,
    currentCapacityTimestamp,
    currentTimeSec
  );
  return resourcesLeft / (shipResourceMaxReserve / 100);
}

let runningProcess;
const gmClientService = new GmClientService();

async function claimAtlas() {
  const txInstructions = [];

  for (const fleet of activeFleets) {
    txInstructions.push(
      await atlas.createHarvestInstruction(
        connection,
        userPublicKey,
        new PublicKey(Web3.atlasTokenMint),
        fleet.shipMint,
        scoreProgramId
      )
    );
  }

  if (!!txInstructions.length) {
    return await sendTransactions(txInstructions);
  }

  return Promise.resolve(false);
}

const sendMarketOrder = async ({ order, quantity }) =>
  await connection.sendTransaction(
    new web3.Transaction().add(
      (
        await gmClientService.getCreateExchangeTransaction(
          connection,
          order,
          userPublicKey,
          quantity,
          traderProgramId
        )
      ).transaction
    ),
    [keypair]
  );

const orderResources = async (nftInformation) => {
  const orders = await gmClientService.getOpenOrdersForPlayer(
    connection,
    new PublicKey(traderOwnerId),
    traderProgramId
  );

  return await Promise.allSettled(
    orders.map(async (order) => {
      const resource = nftInformation.find((nft) => {
        return nft.mint === order.orderMint;
      });
      const resourceName =
        resource.name === "Ammunition" ? "Arms" : resource.name;

      await sendMarketOrder({
        order,
        quantity:
          perDay[resourceName.toLowerCase()].reduce(
            (partialSum, a) => partialSum + a,
            0
          ) * orderForDays,
      }).then(async () => {
        Write.printLine({
          text: "\n  RESOURCE ORDER COMPLETED: " + resource.name,
        });
      });
    })
  );
};

const haveEnoughResources = ({ fleet, shipInfo }, nowSec) => {
  let enoughResources = true;
  for (const resource of Object.keys(resourceAddresses)) {
    const shipAmount = fleet.shipQuantityInEscrow;
    const fleetResource = resource === "toolkit" ? "health" : resource;
    const left = getResourcesLeft(
      fleet[`${fleetResource}CurrentCapacity`],
      shipInfo[
        `millisecondsToBurnOne${
          resource.charAt(0).toUpperCase() + resource.slice(1)
        }`
      ],
      fleet.currentCapacityTimestamp,
      nowSec
    );

    const max = shipInfo[`${resource}MaxReserve`] * shipAmount;
    const current = left * shipAmount;
    const needed = max - current;
    if (resourceAvailability[resource] < needed) {
      enoughResources = false;
    }
  }

  return Promise.resolve(enoughResources);
};

const processAutoBuy = async (shipToAutoBuy) => {
  if (!!shipToAutoBuy) {
    const sellOrders = (
      await gmClientService.getOpenOrdersForAsset(
        connection,
        new PublicKey(autoBuy),
        traderProgramId
      )
    )
      .filter(
        (order) =>
          order.currencyMint === atlasTokenMint && order.orderType === "sell"
      )
      .sort((a, b) => (a.price / DECIMALS < b.price / DECIMALS ? -1 : 1));
    sellOrders.splice(0, 2);
    const [sellOrder] = sellOrders;

    const atlas = inventory.find((item) => item.mint === atlasTokenMint);
    const price =
      sellOrder.price / Number("1".padEnd(sellOrder.currencyDecimals + 1, "0"));

    if (atlas.amount > price) {
      const quantity = Math.floor(atlas.amount / price);
      return await sendMarketOrder({
        order: sellOrder,
        quantity:
          quantity > sellOrder.orderQtyRemaining
            ? sellOrder.orderQtyRemaining
            : quantity,
      });
    }
  }
};

const refillResources = async ({ fleet, shipInfo }) => {
  const txInstructions = [];

  const resources = inventory.filter((item) => item.type === "resource");
  for (const resource of resources) {
    const instruction = await getResupplyInstruction(resource, shipInfo, fleet);
    txInstructions.push(instruction);
  }

  return await sendTransactions(txInstructions);
};

const refreshStakingFleet = async () => {
  activeFleets = await atlas.getAllFleetsForUserPublicKey(
    connection,
    userPublicKey,
    scoreProgramId
  );
};

const refreshInventory = async () => {
  const inventory = [];
  const accountInfo = await Web3.refreshAccountInfo();

  if (autoStake) {
    const ships = accountInfo.filter((value) => value.type === "ship");
    const others = accountInfo.filter((value) => value.type !== "ship");

    if (!!ships.length) {
      for (const ship of ships) {
        Write.printLine({
          text: "\n Auto staking " + ship.name,
          color: Write.colors.fgYellow,
        });
        const fleet = activeFleets.find(
          (fleet) => fleet.shipMint.toString() === ship.mint
        );
        let tx;
        if (!!fleet) {
          tx = await atlas.createPartialDepositInstruction(
            connection,
            userPublicKey,
            ship.amount,
            new PublicKey(ship.mint),
            new PublicKey(ship.tokenAccount),
            new PublicKey(scoreProgramId)
          );
        } else {
          tx = await atlas.createInitialDepositInstruction(
            connection,
            userPublicKey,
            ship.amount,
            new PublicKey(ship.mint),
            new PublicKey(ship.tokenAccount),
            new PublicKey(scoreProgramId)
          );
        }
        if (!!tx) {
          await sendTransactions([tx]).then(async () => {
            Write.printLine([
              {
                text:
                  "\n " +
                  ship.name +
                  " is now staking, it will be reflected on refresh.",
                color: Write.colors.fgYellow,
              },
            ]);
          });
        }
      }
      inventory.push(...others);
    } else {
      inventory.push(...ships, ...others);
    }
  } else {
    inventory.push(...accountInfo);
  }

  return inventory;
};

const printLogo = async () =>
  Write.printLine([
    { text: "\n", color: Write.colors.fgYellow },
    {
      text: " ###  ### ##### ### ##   ## ####    ###  #   #\n",
      color: Write.colors.fgYellow,
    },
    {
      text: "  #    #  #      #  ### ### #   #  #   # #   #\n",
      color: Write.colors.fgYellow,
    },
    {
      text: "  ######  #####  #  #  #  # #    # ##### #   #\n",
      color: Write.colors.fgYellow,
    },
    {
      text: "  #    #  #      #  #     # #   #  #   # #   #\n",
      color: Write.colors.fgYellow,
    },
    {
      text: " ###  ### ##### ### #     # ####   #   # ### ###\n",
      color: Write.colors.fgYellow,
    },
    {
      text: "                - INDUSTRIES -\n",
      color: Write.colors.fgYellow,
    },
    { text: "                   presents\n", color: Write.colors.fgYellow },
    {
      text: "            STAR ATLAS AUTOMATION\n\n",
      color: Write.colors.fgYellow,
    },
    { text: "Options: (b)uy, (c)laim, (q)uit", color: Write.colors.fgRed },
  ]);

async function start() {
  console.clear();
  await printLogo();

  perDay = {
    fuel: [],
    food: [],
    arms: [],
    toolkit: [],
  };

  nowSec = new Date().getTime() / 1000;
  if (!nftInformation.length) {
    Write.printLine([
      { text: " Fetching latest flight data...", color: Write.colors.fgYellow },
    ]);
    nftInformation.push(...(await getNftInformation()));
    nftShipInformation.push(
      ...nftInformation.filter((nft) => nft.attributes.itemType === "ship")
    );
    nftResourceInformation.push(
      ...nftInformation.filter((nft) => nft.attributes.itemType === "resource")
    );
    nftAutoBuyInformation =
      !!autoBuy && nftShipInformation.find((nft) => nft.mint === autoBuy);
  }

  if (!!autoBuy) {
    if (!!nftAutoBuyInformation) {
      Write.printLine({
        text: ` Auto buy enabled for ${nftAutoBuyInformation.name}.`,
        color: Write.colors.fgYellow,
      });
    } else {
      Write.printLine({
        text: `Auto buy value incorrect.`,
        color: Write.colors.fgRed,
      });
    }
  }

  inventory.length = 0;
  await refreshStakingFleet();
  inventory.push(...(await refreshInventory()));
  Write.printAvailableSupply(inventory);

  const transactionFleet = [];
  for (const fleet of activeFleets) {
    let needTransaction = false;

    const nft = nftInformation.find(
      (nft) => nft.mint === fleet.shipMint.toString()
    );
    Write.printLine({
      text: ` | ${nft.name} (${fleet.shipQuantityInEscrow}) |`,
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
      nowSec
    );

    Write.printPercent(healthPercent, "HEALTH");
    if (healthPercent <= triggerPercentage) needTransaction = true;

    const fuelPercent = calculatePercentLeft(
      fleet.fuelCurrentCapacity,
      shipInfo.millisecondsToBurnOneFuel,
      fleet.currentCapacityTimestamp,
      shipInfo.fuelMaxReserve,
      nowSec
    );

    Write.printPercent(fuelPercent, "FUEL");
    if (fuelPercent <= triggerPercentage) needTransaction = true;

    const foodPercent = calculatePercentLeft(
      fleet.foodCurrentCapacity,
      shipInfo.millisecondsToBurnOneFood,
      fleet.currentCapacityTimestamp,
      shipInfo.foodMaxReserve,
      nowSec
    );

    Write.printPercent(foodPercent, "FOOD");
    if (foodPercent <= triggerPercentage) needTransaction = true;

    const armsPercent = calculatePercentLeft(
      fleet.armsCurrentCapacity,
      shipInfo.millisecondsToBurnOneArms,
      fleet.currentCapacityTimestamp,
      shipInfo.armsMaxReserve,
      nowSec
    );

    Write.printPercent(armsPercent, "ARMS");
    if (armsPercent <= triggerPercentage) {
      needTransaction = true;
    }

    if (needTransaction) {
      transactionFleet.push({
        fleet,
        shipInfo,
        nft,
      });
    }

    const calculateDailyUsage = (millisecondsForOne) =>
      (millisecondsInDay / millisecondsForOne) * fleet.shipQuantityInEscrow;
    const {
      millisecondsToBurnOneFuel,
      millisecondsToBurnOneArms,
      millisecondsToBurnOneFood,
      millisecondsToBurnOneToolkit,
    } = shipInfo;
    perDay.fuel.push(calculateDailyUsage(millisecondsToBurnOneFuel));
    perDay.food.push(calculateDailyUsage(millisecondsToBurnOneFood));
    perDay.arms.push(calculateDailyUsage(millisecondsToBurnOneArms));
    perDay.toolkit.push(calculateDailyUsage(millisecondsToBurnOneToolkit));

    Write.printLine({
      text: ` ------------------------`,
    });
  }

  if (transactionFleet.length > 0) {
    for (const { fleet, shipInfo, nft } of transactionFleet) {
      Write.printLine({
        text: `\n ### Resupplying ${nft.name} ###`,
      });

      const hasEnoughResources = await haveEnoughResources(
        { fleet, shipInfo },
        nowSec
      );

      if (hasEnoughResources) {
        await refillResources({ shipInfo, fleet }).then(async () => {
          Write.printLine({ text: "\n  Resources refilled successfully" });
        });
      } else {
        Write.printLine({ text: "\n  Not enough resources, claiming ATLAS" });
        await claimAtlas().then(async (result) => {
          if (!!result) {
            Write.printLine({
              text: " ATLAS claimed successfully, buying resources",
            });
            await orderResources(nftInformation).then(async () => {
              Write.printLine({ text: " Resources bought, resupplying" });
              await refillResources({ shipInfo, fleet }).then(async () => {
                Write.printLine({
                  text: " Resources resupplied successfully",
                });
                await processAutoBuy(nftAutoBuyInformation).then(async () => {
                  Write.printLine({
                    text:
                      " Auto buy order completed: " +
                      nftAutoBuyInformation.name,
                  });
                });
              });
            });
          }
        });
      }
    }
  } else {
    Write.printLine({ text: " No resupply needed." });
  }

  Write.printCheckTime();

  intervalTime =
    args.interval && args.interval > minimumIntervalTime
      ? args.interval < maximumIntervalTime
        ? args.interval
        : maximumIntervalTime
      : minimumIntervalTime;

  Write.printLine({
    text: " Repeating process every " + intervalTime / 60000 + " minute(s).\n",
    color: Write.colors.fgYellow,
  });
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
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.on("keypress", (character) => {
  if (character?.toString() === "q") {
    return exitProcess();
  }
  if (character?.toString() === "b") {
    if (!!nftAutoBuyInformation) {
      Write.printLine({
        text: "Starting auto buy process.",
        color: Write.colors.fgYellow,
      });
      return processAutoBuy(nftAutoBuyInformation).then(() => {
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
    return claimAtlas().then(() => {
      Write.printLine({
        text: "Claim ATLAS process finished.",
        color: Write.colors.fgYellow,
      });
    });
  }
  if (character?.toString() === "i") {
    return Write.printAvailableSupply(resourceAvailability);
  }
  return false;
});

const startInterval = () => {
  if (args.noRunningProcess !== "true") {
    clearInterval(runningProcess);
    runningProcess = setInterval(start, intervalTime);
  } else {
    process.exit(0);
  }
};

start()
  .then(startInterval)
  .catch((err) => console.error(err));
