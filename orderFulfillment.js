export function getFulfilledQuantities(fulfillments = []) {
  const fulfilledQuantities = new Map();

  for (const fulfillment of fulfillments) {
    for (const fulfillmentLineItem of fulfillment.fulfillmentLineItems?.nodes || []) {
      const lineItemId = fulfillmentLineItem.lineItem?.id;
      if (!lineItemId) continue;
      fulfilledQuantities.set(
        lineItemId,
        (fulfilledQuantities.get(lineItemId) || 0) + Number(fulfillmentLineItem.quantity || 0)
      );
    }
  }

  return fulfilledQuantities;
}

export function getIncludedQuantity(item, fulfilledQuantity = 0, includeFulfilledItems = false) {
  const orderedQuantity = Number(item.quantity || 0);
  if (includeFulfilledItems) return orderedQuantity;

  const currentQuantity = Number(item.currentQuantity ?? orderedQuantity);
  return Math.min(orderedQuantity, Math.max(currentQuantity - fulfilledQuantity, 0));
}
