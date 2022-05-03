const fs = require("fs");
const bs58 = require("bs58");
const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory/dist/score");

const connection = new web3.Connection(web3.clusterApiUrl("mainnet-beta"));
const nftNames = JSON.parse(fs.readFileSync("nft_names.json", "utf8"));
const privateKeyStr = fs.readFileSync("key.txt", "utf8");
const keypair = web3.Keypair.fromSeed(bs58.decode(privateKeyStr).slice(0, 32));
const userPublicKey = keypair.publicKey;

const tokenProgramId = new web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const scoreProgId = new web3.PublicKey(
  "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW"
);
const ammunitionTokenMint = "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK";
const foodTokenMint = "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG";
const toolkitTokenMint = "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL";
const fuelTokenMint = "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim";
const atlasTokenMint = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx";
const args = require("minimist")(
  process.argv.filter((val, index) => val.includes("="))
);
function getTokenPublicKey(tokenMint, tokenAccountInfo) {
  return tokenAccountInfo.value.filter(function (v) {
    return v.account.data.parsed.info.mint === tokenMint;
  })[0].pubkey;
}

const printPercent = (percent, text) => {
  process.stdout.write(
    "\033[" +
      (percent < 10 ? "91m " : "92m ") +
      text +
      ": " +
      percent.toFixed(1) +
      "%" +
      " \033[0m \n"
  );
};

async function getTxInstructionFood(shipInfo, fleet, tokenAccountInfo) {
  return await atlas.createRefeedInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    shipInfo.foodMaxReserve * fleet.shipQuantityInEscrow,
    fleet.shipMint,
    new web3.PublicKey(foodTokenMint),
    getTokenPublicKey(foodTokenMint, tokenAccountInfo),
    scoreProgId
  );
}

async function getTxInstructionFuel(shipInfo, fleet, tokenAccountInfo) {
  return await atlas.createRefuelInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    shipInfo.fuelMaxReserve * fleet.shipQuantityInEscrow,
    fleet.shipMint,
    new web3.PublicKey(fuelTokenMint),
    getTokenPublicKey(fuelTokenMint, tokenAccountInfo),
    scoreProgId
  );
}

async function getTxInstructionToolkit(shipInfo, fleet, tokenAccountInfo) {
  return await atlas.createRepairInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    shipInfo.toolkitMaxReserve * fleet.shipQuantityInEscrow,
    fleet.shipMint,
    new web3.PublicKey(toolkitTokenMint),
    getTokenPublicKey(toolkitTokenMint, tokenAccountInfo),
    scoreProgId
  );
}

async function getTxInstructionAmmunition(shipInfo, fleet, tokenAccountInfo) {
  return await atlas.createRearmInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    shipInfo.armsMaxReserve * fleet.shipQuantityInEscrow,
    fleet.shipMint,
    new web3.PublicKey(ammunitionTokenMint),
    getTokenPublicKey(ammunitionTokenMint, tokenAccountInfo),
    scoreProgId
  );
}

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
async function main() {
  const triggerPercentage = 1;
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  const now = new Date();
  const nowSec = now.getTime() / 1000;
  process.stdout.write(
    "\nLast check on: " + now.toLocaleDateString("en-UK", options) + "\n"
  );
  let tokenAccountInfo = await connection.getParsedTokenAccountsByOwner(
    userPublicKey,
    { programId: tokenProgramId },
    "confirmed"
  );
  const userFleets = await atlas.getAllFleetsForUserPublicKey(
    connection,
    userPublicKey,
    scoreProgId
  );

  const transactionFleet = [];
  for (const fleet of userFleets) {
    let needTransaction = false;

    process.stdout.write(
      `\n ${nftNames[fleet.shipMint]} (${fleet.shipQuantityInEscrow}) \n`
    );
    let shipInfo = await atlas.getScoreVarsShipInfo(
      connection,
      scoreProgId,
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

  for (const { fleet, shipInfo } of transactionFleet) {
    process.stdout.write(
      `\n ############ BUYING ############\n Buying for ${
        nftNames[fleet.shipMint]
      } \n`
    );
    const toolkitCall = await getTxInstructionToolkit(
      shipInfo,
      fleet,
      tokenAccountInfo
    );
    const fuelCall = await getTxInstructionFuel(
      shipInfo,
      fleet,
      tokenAccountInfo
    );
    const foodCall = await getTxInstructionFood(
      shipInfo,
      fleet,
      tokenAccountInfo
    );
    const ammoCall = await getTxInstructionAmmunition(
      shipInfo,
      fleet,
      tokenAccountInfo
    );

    await sendTransactions([toolkitCall, fuelCall, foodCall, ammoCall]).then(
      (res) => {
        process.stdout.write("\n[ Resources bought successfully ]\n");
      }
    );
  }
}

const readlineModule = require("readline");
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
    exitProcess();
  }
});

process.stdout.write(
  "Starting STAR ATLAS AUTOMATION \033[91m(press q to quit)\033[0m\n"
);

main()
  .then(() => {
    if (!args.noRunningProcess) {
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

      runningProcess = setInterval(main, intervalTime);
    } else {
      process.exit(0);
    }
  })
  .catch((err) => console.error(err));
