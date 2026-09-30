import "dotenv/config";
import { recalculateAllScores } from "../lib/deals";

/** Recalcula os scores manualmente: `npm run score:recalc` */
async function main() {
  const total = await recalculateAllScores();
  console.log(`${total} deals recalculados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
