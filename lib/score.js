require("dotenv").config();

const fetch = require("node-fetch");
const atlas = require("@staratlas/factory");
const {
  PublicKey,
  Transaction,
  clusterApiUrl,
  Connection,
  Keypair,
  DECIMALS,
} = require("@solana/web3.js");
const {
  atlasTokenMint,
  usdcTokenMint,
  millisecondsInDay,
  traderProgramId,
  traderOwnerId,
  decimals,
  donationsWallet,
} = require("./constants");
const Web3 = require("./web3");
const Write = require("./write");
const web3 = require("@solana/web3.js");
const bs58 = require("bs58");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} = require("@solana/spl-token");

class BigDecimal {
  constructor(value) {
    let [ints, decis] = String(value).split(".").concat("");
    decis = decis.padEnd(BigDecimal.decimals, "0");
    this.bigint = BigInt(ints + decis);
  }
  static fromBigInt(bigint) {
    return Object.assign(Object.create(BigDecimal.prototype), { bigint });
  }
  divide(divisor) {
    // You would need to provide methods for other operations
    return BigDecimal.fromBigInt(
      (this.bigint * BigInt("1" + "0".repeat(BigDecimal.decimals))) /
        divisor.bigint,
    );
  }
  toString() {
    const s = this.bigint.toString().padStart(BigDecimal.decimals + 1, "0");
    return (
      s.slice(0, -BigDecimal.decimals) +
      "." +
      s.slice(-BigDecimal.decimals).replace(/\.?0+$/, "")
    );
  }
}
BigDecimal.decimals = 18;

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
  dailyUsage = { fuel: [], food: [], arms: [], toolkit: [] };
  hasTokenAccount = {};
  triggerPercentage = 1;
  orderForDays = 30;
  resourceAddresses = {
    arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
    food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
    toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
    fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
  };
  scoreProgramId = new PublicKey(
    "FLEET1qqzpexyaDpqb2DGsSzE2sDCizewCg9WjrA6DBW",
  );
  marketProgramId = new PublicKey(
    "AAARDfgJcfHBGn5sWxkt6xUU56ovvjYaxaxowz9D7YnP",
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
    const CONNECTION_MAINNET = clusterApiUrl("mainnet-beta");
    const CONNECTION_GENESYSGO = "https://ssc-dao.genesysgo.net/";
    this.connection = new Connection(
      process.env.CUSTOM_RPC || CONNECTION_MAINNET,
    );
    this.gmClientService = new atlas.GmClientService();
  }

  async claimAtlas() {
    if (!this.hasTokenAccount[atlasTokenMint]) {
      await this.createTokenAccount(atlasTokenMint);
      Write.printLine({
        text: `Created ATLAS token account.`,
        color: Write.colors.fgYellow,
      });
    }
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
      const NUM_DROPS_PER_TX = 10;

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
        for (const transaction of transactions) {
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

            const donationOptOut = process.env.DONATION_OPT_OUT === "true";
            if (donationOptOut) {
              Write.printLine({
                text: "You have opted out on donating to help support development.",
                color: Write.colors.fgRed,
              });
            } else {
              const donationAmount = totalAtlas * 0.03;
              if (donationAmount > 0.01) {
                Write.printLine({
                  text: `Proceeding with the donation of ${donationAmount.toFixed(
                    8,
                  )} ATLAS to help support development.`,
                  color: Write.colors.fgGreen,
                });

                let totalBigDecimal = "0";
                balanceList.forEach(
                  (balance) =>
                    (totalBigDecimal =
                      BigInt(balance.amount) + BigInt(totalBigDecimal)),
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
                    totalBigDecimal / 100n,
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
      ...nftInformation.filter((nft) => nft.attributes.itemType === "resource"),
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
    let ata = await getAssociatedTokenAddress(
      new PublicKey(tokenMint), // mint
      owner, // owner
      false, // allow owner off curve
    );

    let tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountInstruction(
        this.keypair.publicKey, // payer
        ata, // ata
        this.keypair.publicKey, // owner
        new PublicKey(tokenMint), // mint
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
                  type: nft.attributes.itemType,
                });
              }
              break;
          }
        });

      this.inventory = inventory;
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
    this.activeFleets = await atlas.getAllFleetsForUserPublicKey(
      this.connection,
      this.keypair.publicKey,
      this.scoreProgramId,
    );
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
    console.log(`finalized ${sig}`);
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
      Write.printLine({
        text: `${name}${" ".repeat(65 - name.length - 1)}|`,
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
  }

  async calculateDailyUsage() {
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

      this.dailyUsage = { fuel: [], food: [], arms: [], toolkit: [] };
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
      await this.connection.sendTransaction(
        new web3.Transaction().add(
          (
            await this.gmClientService.getCreateExchangeTransaction(
              this.connection,
              order,
              this.keypair.publicKey,
              quantity,
              traderProgramId,
            )
          ).transaction,
        ),
        [this.keypair],
      );
    } catch (e) {
      Write.printError(e);
    }
  }

  async orderResources(nftInformation) {
    const orders = await this.gmClientService.getOpenOrdersForPlayer(
      this.connection,
      new PublicKey(traderOwnerId),
      new PublicKey(traderProgramId),
    );

    return await Promise.allSettled(
      orders.map(async (order) => {
        const resource = nftInformation.find((nft) => {
          return nft.mint === order.orderMint;
        });
        const resourceName =
          resource.name === "Ammunition" ? "Arms" : resource.name;

        await this.sendMarketOrder({
          order,
          quantity:
            this.dailyUsage[resourceName.toLowerCase()].reduce(
              (partialSum, a) => partialSum + a,
              0,
            ) * this.orderForDays,
        }).then(async () => {
          Write.printLine({
            text: " RESOURCE ORDER COMPLETED: " + resource.name,
          });
        });
      }),
    );
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
              await this.orderResources(this.nftInformation.all).then(
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
    if (!!shipToAutoBuy) {
      const sellOrders = (
        await this.gmClientService.getOpenOrdersForAsset(
          this.connection,
          new PublicKey(this.autoBuyFleet.mint),
          traderProgramId,
        )
      )
        .filter(
          (order) =>
            order.currencyMint === atlasTokenMint && order.orderType === "sell",
        )
        .sort((a, b) => (a.price / decimals < b.price / decimals ? -1 : 1));
      sellOrders.splice(0, 2);
      const [sellOrder] = sellOrders;

      const atlas = this.inventory.find((item) => item.mint === atlasTokenMint);
      const price =
        sellOrder.price /
        Number("1".padEnd(sellOrder.currencyDecimals + 1, "0"));

      if (atlas.amount > price) {
        const quantity = Math.floor(atlas.amount / price);
        return await this.sendMarketOrder({
          order: sellOrder,
          quantity:
            quantity > sellOrder.orderQtyRemaining
              ? sellOrder.orderQtyRemaining
              : quantity,
        });
      }
    }
  }
}

module.exports = Score;
