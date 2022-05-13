module.exports = {
  printLine: (message, color) => {
    process.stdout.write("\033[" + color || 0 + "m " + message + " \033[0m \n");
  },
  printCheckTime: () => {
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
    process.stdout.write(
      "\nChecked on: " + now.toLocaleDateString("en-UK", options) + "\n"
    );
  },
  printPercent: (percent, text) => {
    process.stdout.write(
      "\033[" +
        (percent < 10 ? "91m " : "92m ") +
        text +
        ": " +
        percent.toFixed(1) +
        "%" +
        " \033[0m \n"
    );
  },
  printAvailableSupply: (availableSupplies) => {
    process.stdout.write("\n\033[92m == Available supplies ==  \033[0m \n\n");
    Object.entries(availableSupplies).forEach(([name, value]) => {
      process.stdout.write(
        "      " + name.toUpperCase() + ":   " + value + "\n"
      );
    });
    process.stdout.write("\n\033[92m ========================  \033[0m \n");
  },
};
