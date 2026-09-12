import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

const SPIKE_DATABASE_URL_ENV = "T0_POSTGRES_URI";
const PROCESS_NAMESPACE = ["process", "tenant-a", "scope-a"];

async function main() {
  const [mode, key, schema] = process.argv.slice(2);
  const connectionString = process.env[SPIKE_DATABASE_URL_ENV];
  if (!connectionString) {
    throw new Error("missing spike database URL");
  }
  if ((mode !== "write" && mode !== "read") || !key || !schema) {
    throw new Error("expected mode, key, and schema arguments");
  }

  const store = PostgresStore.fromConnString(connectionString, { schema });
  try {
    if (mode === "write") {
      await store.put(PROCESS_NAMESPACE, key, { durable: true });
      return;
    }

    const item = await store.get(PROCESS_NAMESPACE, key);
    process.stdout.write(JSON.stringify(item?.value ?? null));
  } finally {
    await store.stop();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
