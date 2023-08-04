require("dotenv").config();

const { Webhook, MessageBuilder } = require("discord-webhook-node");
class Write {
  constructor() {
    this.colors = {
      reset: "\x1b[0m",
      bright: "\x1b[1m",
      dim: "\x1b[2m",
      underscore: "\x1b[4m",
      blink: "\x1b[5m",
      reverse: "\x1b[7m",
      hidden: "\x1b[8m",
      fgBlack: "\x1b[30m",
      fgRed: "\x1b[31m",
      fgGreen: "\x1b[32m",
      fgYellow: "\x1b[33m",
      fgBlue: "\x1b[34m",
      fgMagenta: "\x1b[35m",
      fgCyan: "\x1b[36m",
      fgWhite: "\x1b[37m",
      bgBlack: "\x1b[40m",
      bgRed: "\x1b[41m",
      bgGreen: "\x1b[42m",
      bgYellow: "\x1b[43m",
      bgBlue: "\x1b[44m",
      bgMagenta: "\x1b[45m",
      bgCyan: "\x1b[46m",
      bgWhite: "\x1b[47m",
    };
  }

  // { text: string, color: number } | { text: string, color: number }[]
  printLine(message) {
    if (!!message) {
      if (!Array.isArray(message))
        return process.stdout.write(
          `${message.color || this.colors.reset}${message.background || ""}${
            message.text
          }${this.colors.reset}\n`,
        );

      const maxLength = message.length;
      message.forEach((item, index) => {
        process.stdout.write(
          `\x1b[${item.color || 0}${item.background || ""}${item.text}${
            this.colors.reset
          }${index + 1 === maxLength ? "\n" : ""}`,
        );
      });
    }
  }

  printCheckTime() {
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
    this.printLine({
      text: "\n Last update: " + now.toLocaleDateString("en-UK", options),
      color: this.colors.fgYellow,
    });
  }

  printPercent(percent, text) {
    const totalBlocks = 50;
    const filledBlocks = Math.round(
      Math.min(100, percent) / (100 / totalBlocks),
    );
    const fullPercent = `${percent.toFixed(1).toString()}%`;
    const parsedPercent = [
      fullPercent.slice(0, filledBlocks),
      fullPercent.slice(filledBlocks),
    ];
    const hasTwoPercentValues = !!parsedPercent[1].length;
    const fillWithSpaces = (fillAmount) => {
      let i = 0;
      let fillerText = "";

      while (i < fillAmount) {
        fillerText = fillerText + " ";
        i++;
      }

      return fillerText;
    };
    const percentBarFiller = (hasLength, toEnd = false) => {
      let fillerText;
      let fillAmount;

      if (!toEnd) {
        fillAmount = filledBlocks - hasLength;
      } else {
        fillAmount = totalBlocks - filledBlocks - hasLength;
      }

      fillerText = fillWithSpaces(fillAmount);
      return fillerText;
    };

    const percentBarText = parsedPercent[0];
    const percentBarToPrint = [
      {
        text: `${percentBarText}${percentBarFiller(percentBarText.length)}`,
        color: this.colors.fgBlack,
        background: this.colors.bgGreen,
      },
    ];
    if (hasTwoPercentValues || filledBlocks < totalBlocks) {
      const secondPercentBarText = parsedPercent[1];
      percentBarToPrint.push({
        text: `${secondPercentBarText}${percentBarFiller(
          secondPercentBarText.length,
          true,
        )}`,
        color: this.colors.fgWhite,
        background: this.colors.bgRed,
      });
    }

    this.printLine([
      { text: ` | `, color: this.colors.reset },
      {
        text: `${text}${fillWithSpaces(8 - text.length)}: `,
        color: this.colors.reset,
      },
      ...percentBarToPrint,
      { text: ` |`, color: this.colors.reset },
    ]);
  }

  printAvailableSupply(inventory, addLine = false) {
    this.printLine({
      text: ` ${"-".repeat(26)} INVENTORY ${"-".repeat(26)}`,
    });
    const currencies = inventory.filter((item) => item.type === "currency");
    const resources = inventory.filter((item) => item.type === "resource");
    const ships = inventory.filter((item) => item.type === "ship");

    currencies
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .forEach((item) => {
        if (!!item.amount) {
          const name = ` | ${item.name.toUpperCase()}: ${item.amount}`;
          this.printLine({
            text: `${name}${" ".repeat(65 - name.length - 1)}|`,
          });
        }
      });
    if (!!ships.length) {
      ships
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .forEach((item) => {
          if (!!item.amount) {
            const name = ` | ${item.name.toUpperCase()}: ${item.amount}`;
            this.printLine({
              text: `${name}${" ".repeat(65 - name.length - 1)}|`,
            });
          }
        });
    }
    resources
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .forEach((item) => {
        if (!!item.amount) {
          const name = ` | ${item.name.toUpperCase()}: ${item.amount}`;
          this.printLine({
            text: `${name}${" ".repeat(65 - name.length - 1)}|`,
          });
        }
      });

    if (addLine) {
      this.printLine({
        text: ` ${"-".repeat(63)}`,
      });
    }
  }

  printLogo() {
    const count = 9;
    this.printLine([
      { text: "\n", color: this.colors.fgYellow },
      {
        text: " ".repeat(count) + "         HEIMDALL INDUSTRIES PRESENTS: \n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          " ---------------------------------------------\n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          " ###  ### ##### ### ####   ####  #   # ##    #\n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          "  #    #  #      #  #   #  #   # #   # # #   #\n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          "  ######  #####  #  #    # ####  #   # #  #  #\n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          "  #    #  #      #  #   #  #   # #   # #   # #\n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          " ###  ### ##### ### ####   #   #  ###  #    ##\n",
        color: this.colors.fgYellow,
      },
      {
        text:
          " ".repeat(count) +
          " ----------- Star Atlas Automation -----------\n",
        color: this.colors.fgYellow,
      },
    ]);
  }

  printRefreshInformation(intervalTime) {
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
    this.printLine([
      {
        text: "\n Running Heimdall Industries Heiðrún Star Atlas Automation",
        color: this.colors.fgYellow,
      },
      {
        text: "\n Last update: " + now.toLocaleDateString("en-UK", options),
        color: this.colors.fgWhite,
      },
      {
        text:
          "\n Repeating process every " + intervalTime / 60000 + " minute(s).",
        color: this.colors.fgWhite,
      },
      {
        text: "\n Options: (i)nventory, (b)uy, (c)laim, (q)uit\n",
        color: this.colors.fgYellow,
      },
    ]);
  }

  printClaimStakesInformation(claimStakeInformation) {
    this.printLine({
      text: ` ${"-".repeat(25)} CLAIMSTAKES ${"-".repeat(25)}`,
    });
    claimStakeInformation.forEach(({ title, percentage, amount }) => {
      const name = ` | ${title} (${amount})`;
      this.printLine({
        text: `${name}${" ".repeat(65 - name.length - 1)}|`,
      });
      this.printPercent(percentage, "PENDING");
    });
  }

  printDailyChurn(dailyUsage, dailyGeneration) {
    const dailyFuel =
      dailyGeneration.fuel.reduce((a, b) => a + b, 0) -
      dailyUsage.fuel.reduce((a, b) => a + b, 0);
    const dailyFood =
      dailyGeneration.food.reduce((a, b) => a + b, 0) -
      dailyUsage.food.reduce((a, b) => a + b, 0);
    const dailyArms =
      dailyGeneration.arms.reduce((a, b) => a + b, 0) -
      dailyUsage.arms.reduce((a, b) => a + b, 0);
    const dailyToolkit =
      dailyGeneration.toolkit.reduce((a, b) => a + b, 0) -
      dailyUsage.toolkit.reduce((a, b) => a + b, 0);

    const positiveDailyFuel = dailyFuel >= 0;
    const positiveDailyFood = dailyFood >= 0;
    const positiveDailyArms = dailyArms >= 0;
    const positiveDailyToolkit = dailyToolkit >= 0;

    this.printLine({
      text: ` ${"-".repeat(23)} DAILY RESOURCES ${"-".repeat(23)}`,
    });
    this.printLine([
      { text: ` | Health: `, color: this.colors.reset },
      {
        text: `${positiveDailyToolkit ? "+" : "-"}${dailyToolkit.toFixed(1)}`,
        color: positiveDailyToolkit ? this.colors.fgGreen : this.colors.fgRed,
      },
      { text: ` Fuel: `, color: this.colors.reset },
      {
        text: `${positiveDailyFuel ? "+" : "-"}${dailyFuel.toFixed(1)}`,
        color: positiveDailyFuel ? this.colors.fgGreen : this.colors.fgRed,
      },
      { text: ` Food: `, color: this.colors.reset },
      {
        text: `${positiveDailyFood ? "+" : "-"}${dailyFood.toFixed(1)}`,
        color: positiveDailyFood ? this.colors.fgGreen : this.colors.fgRed,
      },
      { text: ` Arms: `, color: this.colors.reset },
      {
        text: `${positiveDailyArms ? "+" : "-"}${dailyArms.toFixed(1)}`,
        color: positiveDailyArms ? this.colors.fgGreen : this.colors.fgRed,
      },
      { text: `    |`, color: this.colors.reset },
    ]);
    this.printLine({
      text: ` ${"-".repeat(63)}`,
    });
  }

  printError = (e) =>
    this.printLine([
      {
        text: `\n Something went wrong: ${e.method || e.reason}.\n`,
        color: this.colors.fgRed,
      },
      {
        text: ` Error message: ${e.code}`,
        color: this.colors.fgRed,
      },
    ]);

  sendDiscordMessage = async (message) => {
    const hookId = process.env.DISCORD_WEBHOOK;
    if (!!hookId) {
      const hook = new Webhook(`https://discordapp.com/api/webhooks/${hookId}`);
      await hook.send(message);
    }
  };
}
module.exports = new Write();
