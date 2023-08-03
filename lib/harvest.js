const { PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet, Program } = require("@project-serum/anchor");
const { TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const Write = require("./write");

const claimStakeTiers = [
  {
    mint: "HzUBawF9xxTy4mTuvSkk1a4voJcm65tSHZz6voCDUB33",
    title: "Claim Stake Tier 1",
    claimTime: 179712,
    ammoPerMinute: 0.99,
    foodPerMinute: 1.01,
    fuelPerMinute: 1.5,
    toolsPerMinute: 1.46,
  },
  {
    mint: "2piSPCxbuibsraBnnK4M5rGeHSraNe2oiD8hDw42bPKq",
    title: "Claim Stake Tier 2",
    claimTime: 374112,
    ammoPerMinute: 8.6,
    foodPerMinute: 8.28,
    fuelPerMinute: 7.64,
    toolsPerMinute: 8.92,
  },
  {
    mint: "C2uF4fECabWryVCV1bDuxP7jMspbf2gei3YAP2UBn292",
    title: "Claim Stake Tier 3",
    claimTime: 378432,
    ammoPerMinute: 17.74,
    foodPerMinute: 17.28,
    fuelPerMinute: 19.71,
    toolsPerMinute: 18.4,
  },
  {
    mint: "EBEJj1LKuo1k1J2ZvNJxsXATdGYnfaLWzqxck5p4PXSz",
    title: "Claim Stake Tier 4",
    claimTime: 496800,
    ammoPerMinute: 57.15,
    foodPerMinute: 54.09,
    fuelPerMinute: 57.15,
    toolsPerMinute: 52.05,
  },
  {
    mint: "C2uF4fECabWryVCV1bDuxP7jMspbf2gei3YAP2UBn292",
    title: "Claim Stake Tier 5",
    claimTime: 597888,
    ammoPerMinute: 189.45,
    foodPerMinute: 186.35,
    fuelPerMinute: 149.08,
    toolsPerMinute: 183.26,
  },
];
class Harvest {
  connection;
  keypair;
  wallet;
  provider;
  resourceAccounts;
  resourceAddresses;
  inventory = [];
  dailyGeneration = { fuel: [], food: [], arms: [], toolkit: [] };
  constructor({ connection, keypair }) {
    this.connection = connection;
    this.keypair = keypair;
    this.wallet = new Wallet(keypair);
    this.provider = new AnchorProvider(this.connection, this.wallet, {});
    this.resourceAccounts = new Map();
    this.resourceAddresses = {
      arms: "ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK",
      food: "foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG",
      toolkit: "tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL",
      fuel: "fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim",
    };
  }

  async getResourceAccount(userPublicKey, resource) {
    if (!this.resourceAccounts.get(resource.toString())) {
      const ret = await PublicKey.findProgramAddress(
        [
          userPublicKey.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          resource.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      );

      this.resourceAccounts.set(resource.toString(), ret[0]);
    }

    return this.resourceAccounts.get(resource.toString());
  }

  async getAccounts(accountClient, playerAccount) {
    return accountClient.all([
      { memcmp: { offset: 10, bytes: playerAccount.toBase58() } },
    ]);
  }

  async getVarAccounts(accountClient, mintAccount) {
    return accountClient.all([
      { memcmp: { offset: 9, bytes: mintAccount.toBase58() } },
    ]);
  }

  async harvestAll() {
    const stakeProgram = new PublicKey(
      "STAKEr4Bh8sbBMoAVmTDBRqouPzgdocVrvtjmhJhd65",
    );
    const idl = await Program.fetchIdl(stakeProgram, this.provider);

    if (!idl) {
      throw new Error("idl not found");
    }
    const program = new Program(idl, stakeProgram, this.provider);
    const playerAccount = this.keypair.publicKey;

    // console.log('methods', program.methods); // See possible functions
    const [
      playerFoodTokenAccount,
      playerFuelTokenAccount,
      playerArmsTokenAccount,
      playerToolkitTokenAccount,
    ] = await Promise.all([
      this.getResourceAccount(
        this.keypair.publicKey,
        new PublicKey(this.resourceAddresses.food),
      ),
      this.getResourceAccount(
        this.keypair.publicKey,
        new PublicKey(this.resourceAddresses.fuel),
      ),
      this.getResourceAccount(
        this.keypair.publicKey,
        new PublicKey(this.resourceAddresses.arms),
      ),
      this.getResourceAccount(
        this.keypair.publicKey,
        new PublicKey(this.resourceAddresses.toolkit),
      ),
    ]);

    const accounts = await this.getAccounts(
      program.account.claimStaking,
      playerAccount,
    );

    this.inventory.length = 0;
    await Promise.all(
      accounts.map(async (account) => {
        const {
          account: { mint, lastHarvestTimestamp, claimStakesInEscrow },
        } = account;

        const {
          title,
          claimTime,
          ammoPerMinute,
          foodPerMinute,
          fuelPerMinute,
          toolsPerMinute,
        } = claimStakeTiers.find((e) => e.mint === mint.toString());
        const claimTimeDifference =
          Math.floor(Date.now() / 1000) - lastHarvestTimestamp.toString();
        const canClaim = claimTime - claimTimeDifference < 0;
        const amount = claimStakesInEscrow.toString();
        const claimPercentage =
          100 - (100 / claimTime) * (claimTime - claimTimeDifference);

        if (!canClaim) {
          const minutesInDay = 1440;
          this.inventory.push({
            title,
            amount,
            percentage: claimPercentage,
          });

          this.dailyGeneration = { fuel: [], food: [], arms: [], toolkit: [] };
          this.dailyGeneration.arms.push(ammoPerMinute * amount * minutesInDay);
          this.dailyGeneration.food.push(foodPerMinute * amount * minutesInDay);
          this.dailyGeneration.fuel.push(fuelPerMinute * amount * minutesInDay);
          this.dailyGeneration.toolkit.push(
            toolsPerMinute * amount * minutesInDay,
          );
        } else {
          const [varAccount] = await this.getVarAccounts(
            program.account.claimStakeVar,
            account.account.mint,
          );

          const claimStakingAccount = account.publicKey;
          const claimStakeVarsAccount = varAccount.publicKey;
          const fuelTreasuryTokenAccount = new PublicKey(
            "Fj1fDGX77KoFLbB7tLL5xg9xR7DvJxNmU3yo3QR1hgm",
          );
          const armsTreasuryTokenAccount = new PublicKey(
            "9Dp9Rjh6mmDFPDkLVhp6SbJp2Xj2EDGAWy46yVrfzAFG",
          );
          const foodTreasuryTokenAccount = new PublicKey(
            "4RoeBTjsMyMf7wJ1a3Hi3NsppphgvpVLHaC5Tb4FKUQ8",
          );
          const toolkitTreasuryTokenAccount = new PublicKey(
            "CdQHUngrpj21e5Pi7WD21Uj5w6wDWX4AK1McuedHMDga",
          );
          const treasuryAuthorityAccount = new PublicKey(
            "6gxMWRY4DJnx8WfJi45KqYY1LaqMGEHfX9YdLeQ6Wi5",
          );
          const claimStakeMint = account.account.mint;
          const tokenProgram = new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          );
          await program.methods
            .processHarvest()
            .accounts({
              playerAccount,
              claimStakingAccount,
              claimStakeVarsAccount,
              fuelTreasuryTokenAccount,
              armsTreasuryTokenAccount,
              foodTreasuryTokenAccount,
              toolkitTreasuryTokenAccount,
              playerFuelTokenAccount,
              playerArmsTokenAccount,
              playerFoodTokenAccount,
              playerToolkitTokenAccount,
              treasuryAuthorityAccount,
              claimStakeMint,
              tokenProgram,
            })
            .signers([this.keypair, this.keypair])
            .rpc();
          await Write.sendDiscordMessage(`CLAIMED ${title} (${amount}).`);
          Write.printLine({
            text: `CLAIMED ${title} (${amount}).`,
            color: Write.colors.fgYellow,
          });
          this.inventory.push({
            title,
            amount,
            percentage: 0,
          });
        }
      }),
    );

    return this.inventory;
  }
}

module.exports = Harvest;
