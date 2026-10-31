require("dotenv").config();

const app = require("./app")
const pool = require("./config/db")

async function startServer(){
    if(!process.env.DB_PASSWORD || !process.env.DB_NAME){
        throw new Error("Required database configuration is missing");
    }
    await pool.query("SELECT 1");

    const port = Number(process.env.PORT || 3000);

    const server = app.listen(port, ()=>{
        console.log(`Fincore API running on port ${port}`)
    });
 // Basic graceful shutdown for local development.
  async function shutdown() {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

startServer().catch(async (error) => {
  console.error("FinCore startup failed:", error.message);
  await pool.end();
  process.exit(1);
});
