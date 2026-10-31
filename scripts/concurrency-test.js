const BASE_URL = "http://localhost:3000";

const token = process.env.TEST_ACCESS_TOKEN;

if (!token) {
  throw new Error(
    "Set TEST_ACCESS_TOKEN in your terminal before running."
  );
}

async function transfer(idempotencyKey) {
  const response = await fetch(`${BASE_URL}/transfers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      senderWalletId: "1",
      recipientWalletId: "3",
      amountPaise: "30000",
    }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function main() {
  const results = await Promise.all([
    transfer("concurrency-test-A"),
    transfer("concurrency-test-B"),
  ]);

  console.dir(results, { depth: null });
}

main().catch(console.error);