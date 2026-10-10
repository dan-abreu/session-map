# Backend

Takes the orders and sends the receipts.

## Where in the code

- `backend/`

## Rules that must not break

- `GET /api/ping` answers without a login.
- `GET /api/v1/orders` lists the orders and `POST /api/v1/orders` creates one.
- `GET /api/v1/menu` lists the menu.
- The `receipt` view is the page of one receipt.

## Data

- `orders` has many items.

## What's missing

### Mail

- [ ] **Claude:** Retry a failed receipt three times `ba01`
