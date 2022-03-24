const fs = require('fs');
const bs58 = require("bs58");
const web3 = require("@solana/web3.js");
const atlas = require("@staratlas/factory/dist/score");

const connection = new web3.Connection(web3.clusterApiUrl('mainnet-beta'))
const nftNames = JSON.parse(fs.readFileSync('nft_names.json', 'utf8'))
const privateKeyStr = fs.readFileSync('key.txt', 'utf8')
const keypair = web3.Keypair.fromSeed(bs58.decode(privateKeyStr).slice(0, 32))
const userPublicKey = keypair.publicKey

const tokenProgramId = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const scoreProgId = new web3.PublicKey('FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW')
const ammunitionTokenMint = "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK"
const foodTokenMint = "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG"
const toolkitTokenMint = "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL"
const fuelTokenMint = "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim"
const atlasTokenMint = "ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx"

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
function getTokenPublicKey(tokenMint, tokenAccountInfo) {
  return tokenAccountInfo.value.filter(function (v) {
    return v.account.data.parsed.info.mint === tokenMint
  })[0].pubkey
}

function printRedPercent(percent, text) {
  process.stdout.write(" \033[91m   " + text + ": " + Math.max(0, percent.toFixed(0))  + "%" + " \033[0m \n")
}

function printGreenPercent(percent, text) {
  process.stdout.write(" \033[92m   " + text + ": " + Math.min(100, percent.toFixed(0) ) + "%" + " \033[0m \n")
}

async function getTxInstructionFood(shipInfo, fleet, tokenAccountInfo) {
  return await atlas.createRefeedInstruction(
    connection,
    userPublicKey,
    userPublicKey,
    shipInfo.foodMaxReserve * fleet.shipQuantityInEscrow,
    fleet.shipMint,
    new web3.PublicKey(foodTokenMint),
    getTokenPublicKey(foodTokenMint, tokenAccountInfo),
    scoreProgId,
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
    scoreProgId,
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
    scoreProgId,
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
    scoreProgId,
  );
}

async function sendTransaction(txInstruction) {
  const tx = new web3.Transaction().add(txInstruction)
  const res = await connection.sendTransaction(tx, [keypair])
  console.log("send tx", res)
}

function calculatePercentLeft(fleetResourceBurnOutTime, shipTimeToBurnOneResource, currentCapacityTimestamp, shipResourceMaxReserve, currentTimeSec) {
  const fleetResourceCapacity = fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000)
  const resourcesLeft = fleetResourceCapacity - (currentTimeSec - currentCapacityTimestamp) / (shipTimeToBurnOneResource / 1000)
  return Math.floor(resourcesLeft / ((shipResourceMaxReserve) / 100))
}

async function main() {
  let tokenAccountInfo = await connection.getParsedTokenAccountsByOwner(
    userPublicKey, {programId: tokenProgramId}, 'confirmed'
  );
  let userFleets = await atlas.getAllFleetsForUserPublicKey(connection, userPublicKey, scoreProgId);
  const nowSec = new Date().getTime() / 1000

  for (fleet of userFleets) {
    let shipInfo = await atlas.getScoreVarsShipInfo(connection, scoreProgId, fleet.shipMint);

    const healthPercent = calculatePercentLeft(
      fleet.healthCurrentCapacity,
      shipInfo.millisecondsToBurnOneToolkit,
      fleet.currentCapacityTimestamp,
      shipInfo.toolkitMaxReserve,
      nowSec,
    );
    healthPercent < 10 ? printRedPercent(healthPercent, "HEALTH") : printGreenPercent(healthPercent, "HEALTH")
    if (healthPercent <= 1) await sendTransaction(await getTxInstructionToolkit(shipInfo, fleet, tokenAccountInfo));

    const fuelPercent = calculatePercentLeft(
      fleet.fuelCurrentCapacity,
      shipInfo.millisecondsToBurnOneFuel,
      fleet.currentCapacityTimestamp,
      shipInfo.fuelMaxReserve,
      nowSec,
    );
    fuelPercent < 10 ? printRedPercent(fuelPercent, "FUEL") : printGreenPercent(fuelPercent, "FUEL")
    if (fuelPercent <= 1) await sendTransaction(await getTxInstructionFuel(shipInfo, fleet, tokenAccountInfo));

    const foodPercent = calculatePercentLeft(
      fleet.foodCurrentCapacity,
      shipInfo.millisecondsToBurnOneFood,
      fleet.currentCapacityTimestamp,
      shipInfo.foodMaxReserve,
      nowSec,
    );
    foodPercent < 10 ? printRedPercent(foodPercent, "FOOD") : printGreenPercent(foodPercent, "FOOD")
    if (foodPercent <= 1) await sendTransaction(await getTxInstructionFood(shipInfo, fleet, tokenAccountInfo));

    const armsPercent = calculatePercentLeft(
      fleet.armsCurrentCapacity,
      shipInfo.millisecondsToBurnOneArms,
      fleet.currentCapacityTimestamp,
      shipInfo.armsMaxReserve,
      nowSec,
    );
    armsPercent < 10 ? printRedPercent(armsPercent, "ARMS") : printGreenPercent(armsPercent, "ARMS")
    if (armsPercent <= 1) await sendTransaction(await getTxInstructionAmmunition(shipInfo, fleet, tokenAccountInfo));
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => console.error(err))