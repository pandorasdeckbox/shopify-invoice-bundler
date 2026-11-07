import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterEventLineItems,
  getFulfilledQuantities,
  getIncludedQuantity,
} from './orderFulfillment.js';

test('aggregates fulfilled quantities by order line item across fulfillments', () => {
  const fulfilledQuantities = getFulfilledQuantities([
    {
      fulfillmentLineItems: {
        nodes: [
          { lineItem: { id: 'line-1' }, quantity: 2 },
          { lineItem: { id: 'line-2' }, quantity: 1 },
        ],
      },
    },
    {
      fulfillmentLineItems: {
        nodes: [{ lineItem: { id: 'line-1' }, quantity: 1 }],
      },
    },
  ]);

  assert.equal(fulfilledQuantities.get('line-1'), 3);
  assert.equal(fulfilledQuantities.get('line-2'), 1);
});

test('includes only the remaining current quantity by default', () => {
  assert.equal(getIncludedQuantity({ quantity: 5, currentQuantity: 4 }, 2), 2);
  assert.equal(getIncludedQuantity({ quantity: 2, currentQuantity: 2 }, 2), 0);
  assert.equal(getIncludedQuantity({ quantity: 3, currentQuantity: 3 }, 0), 3);
});

test('can include ordered quantities when fulfilled items are enabled', () => {
  assert.equal(getIncludedQuantity({ quantity: 5, currentQuantity: 4 }, 2, true), 5);
});

test('excludes EVENT line items by title or variant regardless of capitalization', () => {
  const eventItem = { title: 'Special Event Ticket' };
  const variantEventItem = { title: 'Entry', variantTitle: 'eVeNt pass' };
  const regularItem = { title: 'Deck Box', variantTitle: 'Black' };
  const lineItems = [eventItem, variantEventItem, regularItem];

  assert.deepEqual(filterEventLineItems(lineItems), [regularItem]);
  assert.deepEqual(filterEventLineItems(lineItems, true), lineItems);
});
