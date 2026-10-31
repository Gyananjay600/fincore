const url = 'http://localhost:3000/transfers';

// Use your existing access token locally.
// Never paste your token into this chat.
const token = process.env.ACCESS_TOKEN;

const payload = {
  senderWalletId: '1',
  recipientWalletId: '3',
  amountPaise: '1000',
};

async function sendTransfer(requestNumber) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': 'concurrent-idempotency-001',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  return {
    request: requestNumber,
    httpStatus: response.status,
    response: data,
  };
}

async function main() {
  if (!token) {
    throw new Error('ACCESS_TOKEN environment variable is missing');
  }

  const results = await Promise.all([
    sendTransfer(1),
    sendTransfer(2),
  ]);

  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);