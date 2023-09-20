require("dotenv").config();

const fetch = require("node-fetch");
const atlas = require("@staratlas/factory");
const {
  PublicKey,
  Transaction,
  clusterApiUrl,
  Connection,
  Keypair,
} = require("@solana/web3.js");
const {
  atlasTokenMint,
  usdcTokenMint,
  millisecondsInDay,
  traderProgramId,
  donationsWallet,
  donationPercentage,
  donationOptOut,
} = require("./constants");
const Web3 = require("./web3");
const Write = require("./write");
const bs58 = require("bs58");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  AccountLayout,
} = require("@solana/spl-token");
const { BN } = require("@project-serum/anchor");

class Score {
  connection;
  keypair;
  parsedTokenAccountsByOwner;
  nftInformation;
  gmClientService;
  inventory = [];
  autoBuyFleet;
  activeFleets;
  activeFleetsToRefill = [];
  totalRewards = [];
  dailyUsage = { fuel: [], food: [], arms: [], toolkit: [] };
  hasTokenAccount = {};
  triggerPercentage = 10;
  orderForDays = 30;
  autoBuyLastCheckDate;
  resourceAddresses = {
    arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
    food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
    toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
    fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
  };
  scoreProgramId = new PublicKey(
    "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW",
  );
  tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  constructor() {
    if (!!process.env.PRIVATE_KEY) {
      this.keypair = Keypair.fromSeed(
        bs58.decode(process.env.PRIVATE_KEY).slice(0, 32),
      );
    } else {
      Write.printLine({
        text: "\n PrivateKey not found, please check your .env file.\n Exiting process.\n",
        color: Write.colors.fgRed,
      });
      process.exit(0);
    }
    this.connection = new Connection(
      process.env.CUSTOM_RPC || clusterApiUrl("mainnet-beta"),
    );
    this.gmClientService = new atlas.GmClientService();
    this.gmOrderbookService = new atlas.GmOrderbookService(
      this.connection,
      new PublicKey(traderProgramId),
    );
  }

  async ensureTokenAccount(mint) {
    if (!this.hasTokenAccount[mint]) {
      await this.createTokenAccount(mint);
      this.hasTokenAccount[mint] = true;
    }
  }

  async claimAtlas() {
    await this.ensureTokenAccount(atlasTokenMint);
    const harvestInstructions = [];
    for (const fleet of this.activeFleets) {
      const harvestInstruction = await atlas.createHarvestInstruction(
        this.connection,
        this.keypair.publicKey,
        new PublicKey(atlasTokenMint),
        fleet.shipMint,
        this.scoreProgramId,
      );
      harvestInstructions.push(harvestInstruction);
    }

    if (harvestInstructions.length) {
      const splitHarvestInstructions = [];
      const NUM_DROPS_PER_TX = 5;

      for (let i = 0; i < harvestInstructions.length; i += NUM_DROPS_PER_TX) {
        const chunk = harvestInstructions.slice(i, i + NUM_DROPS_PER_TX);
        splitHarvestInstructions.push(chunk);
      }

      const transactions = [];
      for (const instructions of splitHarvestInstructions) {
        const transaction = new Transaction();
        transaction.add(...instructions);
        transactions.push(transaction);
      }

      if (transactions.length) {
        const txList = [];
        Write.printLine({
          text: `Claiming ATLAS in ${transactions.length} transaction(s).`,
          color: Write.colors.fgYellow,
        });
        let transactionNumber = 1;
        for (const transaction of transactions) {
          Write.printLine({
            text: `Preparing transaction ${transactionNumber}/${transaction.length}.`,
            color: Write.colors.fgYellow,
          });
          transaction.recentBlockhash = (
            await this.connection.getLatestBlockhash("finalized")
          ).blockhash;
          transaction.sign(this.keypair, this.keypair);
          const txId = transaction.signatures[0].signature;
          if (!txId) {
            throw new Error("Could not derive transaction signature");
          }
          const txIdStr = bs58.encode(txId);
          const wireTransaction = transaction.serialize();
          await this.connection.sendRawTransaction(wireTransaction);
          await this.finalize(txIdStr);
          transactionNumber++;
          txList.push(txIdStr);
        }

        if (txList.length) {
          const balanceList = [];
          for (const tx of txList) {
            const txDetails = await this.connection.getTransaction(tx);
            const { preTokenBalances, postTokenBalances } = txDetails.meta;
            const preTokenBalance = preTokenBalances.find(
              (balance) =>
                balance.owner === this.keypair.publicKey.toString() &&
                balance.mint === atlasTokenMint,
            );
            const postTokenBalance = postTokenBalances.find(
              (balance) =>
                balance.owner === this.keypair.publicKey.toString() &&
                balance.mint === atlasTokenMint,
            );

            balanceList.push({
              amount: (
                BigInt(postTokenBalance.uiTokenAmount.amount) -
                BigInt(preTokenBalance.uiTokenAmount.amount)
              ).toString(),
              uiAmount:
                postTokenBalance.uiTokenAmount.uiAmount -
                preTokenBalance.uiTokenAmount.uiAmount,
            });
          }

          if (balanceList.length) {
            const totalAtlas = balanceList.reduce(
              (partialSum, balance) => partialSum + balance.uiAmount,
              0,
            );

            Write.printLine({
              text: `You have successfully claimed ${totalAtlas.toFixed(
                2,
              )} ATLAS.`,
              color: Write.colors.fgYellow,
            });

            if (donationOptOut) {
              Write.printLine({
                text: "You have opted out on donating to help support development.",
                color: Write.colors.fgRed,
              });
            } else {
              const donationAmount = totalAtlas / (100 / donationPercentage);
              if (donationAmount > 0.01) {
                Write.printLine({
                  text: `Proceeding with the donation of ${donationAmount.toFixed(
                    8,
                  )} ATLAS to help support development.`,
                  color: Write.colors.fgGreen,
                });

                let totalBigInt = "0";
                balanceList.forEach(
                  (balance) =>
                    (totalBigInt =
                      BigInt(balance.amount) + BigInt(totalBigInt)),
                );

                const userAtlasTokenAccount =
                  await this.connection.getTokenAccountsByOwner(
                    this.keypair.publicKey,
                    {
                      mint: new PublicKey(atlasTokenMint),
                    },
                  );
                let donationAtlasTokenAccount =
                  await this.connection.getTokenAccountsByOwner(
                    new PublicKey(donationsWallet),
                    {
                      mint: new PublicKey(atlasTokenMint),
                    },
                  );

                const donationTx = new Transaction();
                donationTx.add(
                  createTransferCheckedInstruction(
                    userAtlasTokenAccount.value[0].pubkey,
                    new PublicKey(atlasTokenMint),
                    donationAtlasTokenAccount.value[0].pubkey,
                    this.keypair.publicKey,
                    totalBigInt / BigInt(100 / donationPercentage),
                    8,
                  ),
                );
                Write.printLine({
                  text: `Your ATLAS donation with tx ${await this.connection.sendTransaction(
                    donationTx,
                    [this.keypair, this.keypair],
                  )} has been successful, thank you for your support!`,
                  color: Write.colors.fgGreen,
                });
              }
            }
          }
        }
      }
    }

    return Promise.resolve(false);
  }

  async getStarAtlasNftInformation() {
    const nftInformation = await (
      await fetch("https://galaxy.staratlas.com/nfts")
    ).json();

    const ships = [
      ...nftInformation.filter((nft) => nft.attributes.itemType === "ship"),
    ];
    const resources = [
      ...nftInformation.filter(
        (nft) =>
          nft.attributes.itemType === "resource" &&
          nft.attributes.category === "resource",
      ),
    ];

    this.nftInformation = {
      all: nftInformation,
      ships,
      resources,
    };

    if (process.env.AUTO_BUY) {
      this.autoBuyFleet = this.nftInformation.ships?.find(
        (nft) => nft.mint === process.env.AUTO_BUY,
      );

      if (!this.autoBuyFleet) {
        Write.printLine({
          text: `Auto buy value incorrect.`,
          color: Write.colors.fgRed,
        });
      }
    }
  }

  async createTokenAccount(tokenMint, owner = this.keypair.publicKey) {
    Write.printLine({
      text: `Creating token account for ${tokenMint}.`,
      color: Write.colors.fgYellow,
    });
    let ata = await getAssociatedTokenAddress(
      new PublicKey(tokenMint),
      owner,
      false,
    );

    let tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountInstruction(
        this.keypair.publicKey,
        ata,
        this.keypair.publicKey,
        new PublicKey(tokenMint),
      ),
    );

    await this.connection.sendTransaction(tx, [this.keypair]);
  }

  async parseTokenAccount(tokenMint) {
    this.hasTokenAccount[tokenMint] =
      this.parsedTokenAccountsByOwner.value.some(
        (value) => tokenMint === value.account.data.parsed.info.mint,
      );
  }

  async parseTokenAccounts() {
    const tokens = [
      atlasTokenMint,
      usdcTokenMint,
      ...Object.values(this.resourceAddresses),
    ];
    tokens.forEach((tokenMint) => this.parseTokenAccount(tokenMint));
  }

  async refreshScoreAccountInfo() {
    const inventory = [];
    this.parsedTokenAccountsByOwner =
      await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: this.tokenProgramId },
        "confirmed",
      );

    // WALLET CONTENT
    if (!!this.parsedTokenAccountsByOwner?.value.length) {
      await this.parseTokenAccounts();
      await this.parsedTokenAccountsByOwner.value
        .filter(
          (value) =>
            !!value?.account?.data?.parsed?.info?.tokenAmount?.uiAmount,
        )
        .forEach((value) => {
          const { info } = value.account.data.parsed;

          switch (info.mint) {
            case atlasTokenMint:
              inventory.push({
                name: "ATLAS",
                tokenAccount: value.pubkey.toString(),
                mint: info.mint,
                owner: info.owner,
                amount: info.tokenAmount.uiAmount,
                rawAmount: info.tokenAmount.amount,
                type: "currency",
              });
              break;
            case usdcTokenMint:
              inventory.push({
                name: "USDC",
                tokenAccount: value.pubkey.toString(),
                mint: info.mint,
                owner: info.owner,
                amount: info.tokenAmount.uiAmount,
                rawAmount: info.tokenAmount.amount,
                type: "currency",
              });
              break;
            default:
              const nft = this.nftInformation.all.find((nft) => {
                return nft.mint === info.mint;
              });

              if (!!nft) {
                inventory.push({
                  name: nft.name,
                  tokenAccount: value.pubkey.toString(),
                  mint: info.mint,
                  owner: info.owner,
                  amount: info.tokenAmount.uiAmount,
                  rawAmount: info.tokenAmount.amount,
                  type: nft.attributes.category,
                });
              }
              break;
          }
        });

      this.inventory = inventory.sort((a, b) => {
        if (a.type === "currency" && b.type !== "currency") {
          return -1;
        } else if (a.type === "resource" && b.type !== "resource") {
          return -1;
        }
        return 1;
      });
    }

    return inventory;
  }

  async sendTransactions(txInstruction) {
    try {
      const tx = new Transaction().add(...txInstruction);
      return await this.connection.sendTransaction(tx, [this.keypair]);
    } catch (e) {
      Write.printError(e);
    }
  }

  async refreshStakingFleet() {
    const parsedActiveFleets = [];
    const activeFleets = await atlas.getAllFleetsForUserPublicKey(
      this.connection,
      this.keypair.publicKey,
      this.scoreProgramId,
    );

    for (const activeFleet of activeFleets) {
      const shipInfo = await atlas.getScoreVarsShipInfo(
        this.connection,
        this.scoreProgramId,
        activeFleet.shipMint,
      );
      const timeEarning =
        Date.now() / 1000 - activeFleet.currentCapacityTimestamp.toNumber();
      const pendingReward =
        Number(activeFleet.shipQuantityInEscrow) *
        (Number(activeFleet.totalTimeStaked) -
          Number(activeFleet.stakedTimePaid) +
          timeEarning) *
        Number(shipInfo.rewardRatePerSecond);

      parsedActiveFleets.push({ ...activeFleet, ...shipInfo, pendingReward });
    }

    this.activeFleets = parsedActiveFleets;
  }

  async autoStake(ships) {
    for (const ship of ships) {
      Write.printLine({
        text: "\n Auto staking " + ship.name,
        color: Write.colors.fgYellow,
      });
      const fleet = this.activeFleets.find(
        (fleet) => fleet.shipMint.toString() === ship.mint,
      );
      let tx;
      if (!!fleet) {
        tx = await atlas.createPartialDepositInstruction(
          this.connection,
          this.keypair.publicKey,
          ship.amount,
          new PublicKey(ship.mint),
          new PublicKey(ship.tokenAccount),
          this.scoreProgramId,
        );
      } else {
        tx = await atlas.createInitialDepositInstruction(
          this.connection,
          this.keypair.publicKey,
          ship.amount,
          new PublicKey(ship.mint),
          new PublicKey(ship.tokenAccount),
          this.scoreProgramId,
        );
      }
      if (!!tx) {
        await this.sendTransactions([tx]).then(async () => {
          Write.printLine({
            text:
              "\n " +
              ship.name +
              " is now staking, it will be reflected on refresh.",
            color: Write.colors.fgYellow,
          });
        });
        await Write.sendDiscordMessage(`Staked ${ship.name}.`);
      }
    }
  }

  async refreshInventory() {
    this.inventory.length = 0;
    const inventory = [];
    const accountInfo = await this.refreshScoreAccountInfo();

    if (Web3.autoStake) {
      const ships = accountInfo.filter((value) => value.type === "ship");
      const others = accountInfo.filter((value) => value.type !== "ship");

      if (!!ships.length) {
        await this.autoStake(ships);
        inventory.push(...others);
      } else {
        inventory.push(...ships, ...others);
      }
    } else {
      inventory.push(...accountInfo);
    }

    this.inventory = inventory;
  }
  async sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  async finalize(sig) {
    let finalized = false;

    do {
      await this.sleep(5000);

      const status = await this.connection.getSignatureStatus(sig);

      if (status?.value?.confirmationStatus === "finalized") {
        finalized = true;
      } else {
        console.log(`Waiting for finalization: ${status.value?.confirmations}`);
      }
    } while (!finalized);
    console.log(`finalized: https://solscan.io/tx/${sig}`);
  }

  getResourcesLeft(
    fleetResourceBurnOutTime,
    shipTimeToBurnOneResource,
    currentCapacityTimestamp,
    currentTimeSec,
  ) {
    const fleetResourceCapacity =
      fleetResourceBurnOutTime / (shipTimeToBurnOneResource / 1000);
    return (
      fleetResourceCapacity -
      (currentTimeSec - currentCapacityTimestamp) /
        (shipTimeToBurnOneResource / 1000)
    );
  }

  async checkRefillStateOfFleet() {
    this.activeFleetsToRefill.length = 0;
    const nowSec = new Date().getTime() / 1000;
    this.totalRewards = [];

    for (const fleet of this.activeFleets) {
      const calculatePercentLeft = (
        fleetResourceBurnOutTime,
        shipTimeToBurnOneResource,
        currentCapacityTimestamp,
        shipResourceMaxReserve,
        currentTimeSec,
      ) => {
        const resourcesLeft = this.getResourcesLeft(
          fleetResourceBurnOutTime,
          shipTimeToBurnOneResource,
          currentCapacityTimestamp,
          currentTimeSec,
        );
        return resourcesLeft / (shipResourceMaxReserve / 100);
      };
      const { pendingReward } = fleet;
      this.totalRewards.push(pendingReward);
      let needTransaction = false;

      const nft = this.nftInformation.all.find(
        (nft) => nft.mint === fleet.shipMint.toString(),
      );
      const shipInfo = await atlas.getScoreVarsShipInfo(
        this.connection,
        this.scoreProgramId,
        new PublicKey(nft.mint),
      );
      const name = ` | ${nft.name} (${fleet.shipQuantityInEscrow})`;
      const pendingRewards = `Rewards: ${(
        Number(pendingReward) /
        10 ** 8
      ).toFixed(2)}`;
      Write.printLine({
        text: `${name}${" ".repeat(
          65 - name.length - pendingRewards.length - 2,
        )}${pendingRewards} |`,
      });

      const healthPercent = calculatePercentLeft(
        fleet.healthCurrentCapacity,
        shipInfo.millisecondsToBurnOneToolkit,
        fleet.currentCapacityTimestamp,
        shipInfo.toolkitMaxReserve,
        nowSec,
      );

      Write.printPercent(healthPercent > 0 ? healthPercent : 0, "HEALTH");
      if (healthPercent <= this.triggerPercentage) needTransaction = true;

      const fuelPercent = calculatePercentLeft(
        fleet.fuelCurrentCapacity,
        shipInfo.millisecondsToBurnOneFuel,
        fleet.currentCapacityTimestamp,
        shipInfo.fuelMaxReserve,
        nowSec,
      );

      Write.printPercent(fuelPercent > 0 ? fuelPercent : 0, "FUEL");
      if (fuelPercent <= this.triggerPercentage) needTransaction = true;

      const foodPercent = calculatePercentLeft(
        fleet.foodCurrentCapacity,
        shipInfo.millisecondsToBurnOneFood,
        fleet.currentCapacityTimestamp,
        shipInfo.foodMaxReserve,
        nowSec,
      );

      Write.printPercent(foodPercent > 0 ? foodPercent : 0, "FOOD");
      if (foodPercent <= this.triggerPercentage) needTransaction = true;

      const armsPercent = calculatePercentLeft(
        fleet.armsCurrentCapacity,
        shipInfo.millisecondsToBurnOneArms,
        fleet.currentCapacityTimestamp,
        shipInfo.armsMaxReserve,
        nowSec,
      );

      Write.printPercent(armsPercent > 0 ? armsPercent : 0, "ARMS");
      if (armsPercent <= this.triggerPercentage) {
        needTransaction = true;
      }

      if (needTransaction) {
        this.activeFleetsToRefill.push({
          fleet,
          shipInfo,
          nft,
        });
      }
    }
    const totalPendingRewards =
      this.totalRewards.reduce((a, b) => a + b, 0) / 10 ** 8;
    const totalPendingRewardsText = `Pending ATLAS: ${totalPendingRewards.toFixed(
      2,
    )}`;
    const totalPendingRewardsUsd =
      Number(await this.getCurrentAtlasPrice()) * totalPendingRewards;
    const totalPendingRewardsUsdText = `Pending in USD: ${totalPendingRewardsUsd.toFixed(
      2,
    )}`;
    Write.printLine({
      text: ` |${" ".repeat(
        62 - totalPendingRewardsText.length - 1,
      )}${totalPendingRewardsText} |`,
    });
    if (totalPendingRewardsUsd > 0) {
      Write.printLine({
        text: ` |${" ".repeat(
          62 - totalPendingRewardsUsdText.length - 1,
        )}${totalPendingRewardsUsdText} |`,
      });
    }
  }

  async getCurrentAtlasPrice() {
    const atlasInformation = await (
      await fetch(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=star-atlas",
      )
    ).json();
    return atlasInformation.length ? atlasInformation[0].current_price : 0;
  }

  async calculateDailyUsage() {
    this.dailyUsage = { fuel: [], food: [], arms: [], toolkit: [] };

    for (const fleet of this.activeFleets) {
      const calculateUsage = (millisecondsForOne) =>
        (millisecondsInDay / millisecondsForOne) * fleet.shipQuantityInEscrow;
      const {
        millisecondsToBurnOneFuel,
        millisecondsToBurnOneArms,
        millisecondsToBurnOneFood,
        millisecondsToBurnOneToolkit,
      } = await atlas.getScoreVarsShipInfo(
        this.connection,
        this.scoreProgramId,
        fleet.shipMint,
      );

      this.dailyUsage.fuel.push(calculateUsage(millisecondsToBurnOneFuel));
      this.dailyUsage.food.push(calculateUsage(millisecondsToBurnOneFood));
      this.dailyUsage.arms.push(calculateUsage(millisecondsToBurnOneArms));
      this.dailyUsage.toolkit.push(
        calculateUsage(millisecondsToBurnOneToolkit),
      );
    }
  }

  async showFleet() {
    if (!!this.activeFleets.length) {
      Write.printLine({
        text: ` ${"-".repeat(27)} STAKING ${"-".repeat(27)}`,
      });
      this.activeFleets.sort((a, b) =>
        this.nftInformation.all.find(
          (nft) => nft.mint === a.shipMint.toString(),
        )?.name <
        this.nftInformation.all.find(
          (nft) => nft.mint === b.shipMint.toString(),
        )?.name
          ? -1
          : 1,
      );
    } else {
      Write.printLine({
        text: ` ${"-".repeat(63)}`,
      });
    }

    await this.checkRefillStateOfFleet();
    await this.calculateDailyUsage();
  }

  async haveEnoughResources({ fleet, shipInfo }, nowSec) {
    let enoughResources = true;
    for (const resource of Object.keys(this.resourceAddresses)) {
      const shipAmount = fleet.shipQuantityInEscrow;
      const fleetResource = resource === "toolkit" ? "health" : resource;
      const resourceLeft = this.getResourcesLeft(
        fleet[`${fleetResource}CurrentCapacity`],
        shipInfo[
          `millisecondsToBurnOne${
            resource.charAt(0).toUpperCase() + resource.slice(1)
          }`
        ],
        fleet.currentCapacityTimestamp,
        nowSec,
      );

      const maxResource = shipInfo[`${resource}MaxReserve`] * shipAmount;
      const currentResource = resourceLeft * shipAmount;
      const neededResource = maxResource - currentResource;
      if (this.inventory[resource] < neededResource) {
        enoughResources = false;
      }
    }

    return Promise.resolve(enoughResources);
  }

  async getResupplyInstruction(resource, shipInfo, fleet) {
    const nowSec = new Date().getTime() / 1000;
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
            this.getResourcesLeft(
              fleet.armsCurrentCapacity,
              shipInfo.millisecondsToBurnOneArms,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      case "Food":
        createInstruction = createRefeedInstruction;
        quantity =
          (shipInfo.foodMaxReserve -
            this.getResourcesLeft(
              fleet.foodCurrentCapacity,
              shipInfo.millisecondsToBurnOneFood,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      case "Fuel":
        createInstruction = createRefuelInstruction;
        quantity =
          (shipInfo.fuelMaxReserve -
            this.getResourcesLeft(
              fleet.fuelCurrentCapacity,
              shipInfo.millisecondsToBurnOneFuel,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      case "Toolkit":
        createInstruction = createRepairInstruction;
        quantity =
          (shipInfo.toolkitMaxReserve -
            this.getResourcesLeft(
              fleet.healthCurrentCapacity,
              shipInfo.millisecondsToBurnOneToolkit,
              fleet.currentCapacityTimestamp,
              nowSec,
            )) *
          fleet.shipQuantityInEscrow;
        break;
      default:
        return false;
    }

    return await createInstruction(
      this.connection,
      this.keypair.publicKey,
      this.keypair.publicKey,
      quantity,
      fleet.shipMint,
      new PublicKey(resource.mint),
      new PublicKey(resource.tokenAccount),
      this.scoreProgramId,
    );
  }

  async refillResources({ fleet, shipInfo }) {
    const txInstructions = [];

    const resources = this.inventory.filter((item) => item.type === "resource");
    for (const resource of resources) {
      const instruction = await this.getResupplyInstruction(
        resource,
        shipInfo,
        fleet,
      );
      txInstructions.push(instruction);
    }
    return await this.sendTransactions(txInstructions);
  }

  async sendMarketOrder({ order, quantity }) {
    try {
      return await this.connection.sendTransaction(
        new Transaction().add(
          (
            await this.gmClientService.getCreateExchangeTransaction(
              this.connection,
              order,
              this.keypair.publicKey,
              quantity,
              new PublicKey(traderProgramId),
            )
          ).transaction,
        ),
        [this.keypair],
      );
    } catch (e) {
      Write.printError(e);
    }
  }

  async initializeMarket() {
    await this.gmOrderbookService.initialize();
  }

  async getTokenBalance(mint) {
    const tokenAccounts = await this.connection.getTokenAccountsByOwner(
      this.keypair.publicKey,
      {
        programId: TOKEN_PROGRAM_ID,
        mint: new PublicKey(mint),
      },
    );
    if (tokenAccounts.value.length) {
      const accountData = AccountLayout.decode(
        tokenAccounts.value[0].account.data,
      );
      return accountData.amount;
    }

    return 0;
  }

  async orderResources(resourceInformation) {
    await this.initializeMarket();

    const transactionCosts = [];
    const transactions = [];

    for (const resource of resourceInformation) {
      const orders = this.gmOrderbookService
        .getSellOrdersByCurrencyAndItem(atlasTokenMint, resource.mint)
        .sort((a, b) => a.uiPrice - b.uiPrice);
      const resourceName =
        resource.name === "Ammunition" ? "Arms" : resource.name;

      transactionCosts.push(
        new BN(
          orders[0].price *
            (this.dailyUsage[resourceName.toLowerCase()].reduce(
              (partialSum, a) => partialSum + a,
              0,
            ) *
              this.orderForDays),
        ),
      );
      transactions.push(
        await this.gmClientService.getCreateExchangeTransaction(
          this.connection,
          orders[0],
          this.keypair.publicKey,
          this.dailyUsage[resourceName.toLowerCase()].reduce(
            (partialSum, a) => partialSum + a,
            0,
          ) * this.orderForDays,
          new PublicKey(traderProgramId),
        ),
      );
    }

    const availableAtlas = await this.getTokenBalance(atlasTokenMint);
    const totalCost = transactionCosts.reduce(
      (partialSum, a) => partialSum.add(a),
      new BN(0),
    );

    if (availableAtlas >= totalCost) {
      Write.printLine({
        text: `Ordering resources in ${transactions.length} transaction(s).`,
        color: Write.colors.fgYellow,
      });
      for (const order of transactions) {
        const { transaction } = order;
        transaction.recentBlockhash = (
          await this.connection.getLatestBlockhash("finalized")
        ).blockhash;
        transaction.sign(this.keypair, this.keypair);
        const txId = transaction.signatures[0].signature;
        if (!txId) {
          throw new Error("Could not derive transaction signature");
        }
        const txIdStr = bs58.encode(txId);
        const wireTransaction = transaction.serialize();
        await this.connection.sendRawTransaction(wireTransaction);
        await this.finalize(txIdStr);
      }
    } else {
      Write.printLine({
        text: "Not enough ATLAS to order resources.",
        color: Write.colors.fgRed,
      });
    }
  }

  async refillFleet() {
    const nowSec = new Date().getTime() / 1000;
    if (this.activeFleetsToRefill.length > 0) {
      for (const { fleet, shipInfo, nft } of this.activeFleetsToRefill) {
        Write.printLine({
          text: `\n ### Resupplying ${nft.name} ###`,
        });

        const hasEnoughResources = await this.haveEnoughResources(
          { fleet, shipInfo },
          nowSec,
        );

        if (hasEnoughResources) {
          await this.refillResources({ shipInfo, fleet }).then(async () => {
            Write.printLine({ text: "\n  Resources refilled successfully" });
            await Write.sendDiscordMessage(`Resupplied ${nft.name}.`);
          });
        } else {
          Write.printLine({ text: "\n  Not enough resources, claiming ATLAS" });
          await this.claimAtlas().then(async (result) => {
            if (!!result) {
              Write.printLine({
                text: " ATLAS claimed successfully, buying resources",
              });
              await this.orderResources(this.nftInformation.resources).then(
                async () => {
                  Write.printLine({ text: " Resources bought, resupplying" });
                  await this.refillResources({ shipInfo, fleet }).then(
                    async () => {
                      Write.printLine({
                        text: " Resources resupplied successfully",
                      });
                      if (!!this.autoBuyFleet) {
                        await this.processAutoBuy(this.autoBuyFleet).then(
                          async () => {
                            Write.printLine({
                              text:
                                " Auto buy order completed: " +
                                this.autoBuyFleet.name,
                            });
                          },
                        );
                      }
                    },
                  );
                },
              );
            }
          });
        }
      }
    }
  }

  async processAutoBuy(shipToAutoBuy) {
    const dayInMilliseconds = 86400000;
    const timeSinceLastCheck =
      new Date() - (this.autoBuyLastCheckDate || new Date());
    const dailAutoBuyCheck =
      timeSinceLastCheck === 0 || timeSinceLastCheck > dayInMilliseconds;

    if (dailAutoBuyCheck && !!shipToAutoBuy) {
      Write.printLine({
        text: `\n Starting process for possible buy of ${shipToAutoBuy.name}.`,
        color: Write.colors.fgYellow,
      });
      await this.initializeMarket();
      const orders = this.gmOrderbookService
        .getSellOrdersByCurrencyAndItem(atlasTokenMint, shipToAutoBuy.mint)
        .sort((a, b) => a.uiPrice - b.uiPrice);
      const bestOrder = orders[0];
      const walletAtlasAmount =
        this.inventory.find((item) => item.mint === atlasTokenMint)
          ?.rawAmount || 0;
      const pendingAtlas = this.totalRewards.reduce((a, b) => a + b, 0);
      const donationAmount = donationOptOut
        ? 0
        : pendingAtlas / (100 / donationPercentage);
      const availableAtlas =
        Number(pendingAtlas) +
        Number(walletAtlasAmount) -
        Number(donationAmount);
      if (Number(bestOrder.price) > availableAtlas) {
        return Write.printLine({
          text: ` Currently not enough ATLAS to buy ${shipToAutoBuy.name}, checking again in 24h.`,
          color: Write.colors.fgYellow,
        });
      }

      const quantity = Math.floor(availableAtlas / bestOrder.price);
      Write.printLine({
        text: `Preparing to buy ${quantity} ${shipToAutoBuy.name}s.`,
        color: Write.colors.fgYellow,
      });
      const tx = await this.sendMarketOrder({ order: bestOrder, quantity });
      await this.finalize(tx);
      Write.printLine({
        text: `Successfully bought ${quantity} ${shipToAutoBuy.name}s, auto staking on next refresh.`,
        color: Write.colors.fgGreen,
      });
    }
    this.autoBuyLastCheckDate = new Date();
  }
}

module.exports = Score;
