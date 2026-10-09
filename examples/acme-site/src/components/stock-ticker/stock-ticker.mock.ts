export default function mock(props: any) {
  const symbol = props.symbol || 'ADBE';
  return {
    symbol,
    quotes: new Promise((resolve) => {
      // Simulate network latency for out-of-order streaming demo
      setTimeout(() => {
        resolve({
          symbol,
          price: 520.45,
          change: '+4.82',
          positive: true,
        });
      }, 50);
    }),
  };
}
