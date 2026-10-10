# Orders

Takes an order, charges the card and tells the customer.

## Where in the code

- `apps/api/` and `packages/adapters/`

## Rules that must not break

- `GET /v1/orders/:id` returns one order and `POST /v1/orders` creates it.
- `DELETE /v1/orders/:id` cancels an order.
- `GET /status` answers without a login.

## What's missing

### Payments

- [ ] **with Ana:** Refund flow `or01`
- [x] Card charge through the payment provider `or02`
