# Task 0060: Provenance Pipeline Tab

**Status**: Completed
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0059, 0061
**Blocks**: None

## Overview
Create a new top-level "Provenance" page at `/provenance` in the main navigation. This is the command center for tracking the full lifecycle pipeline of book acquisitions. The user must see at a glance where every in-progress book is, when it's arriving, and where it's going. Book posters and rich metadata are used throughout to make items instantly recognizable.

This is the first feature that ties together works, editions, instances, locations, vendors, and orders into a unified visual experience.

## Architecture

### Core entity: `orders`
Orders are standalone entities, managed primarily from the Provenance page. They represent the acquisition journey of a book -- from the moment you decide to buy it until it's on your shelf.

**Key relationships:**
- `orders.workId` → `works` (required: which work is being acquired)
- `orders.editionId` → `editions` (optional: specific edition, may not be known at order time)
- `orders.instanceId` → `instances` (nullable: linked when delivered and instance is created)
- `orders.venueId` → `venues` (optional: where it was bought, Task 0061)
- `orders.destinationLocationId` → `locations` (where it's going)

**Why orders are not instances:**
Before delivery, no instance exists. An instance requires `editionId` + `locationId` which may not be known at order time. The order is a "pre-instance" tracker. On delivery, an instance is spawned and linked.

### Acquisition methods
Different acquisition scenarios require different pipeline flows:

| Method | Pipeline stages | Has shipping? |
|--------|----------------|---------------|
| `online_order` | placed → confirmed → shipped → in_transit → out_for_delivery → delivered | Yes |
| `in_store_purchase` | purchased (single step) | No |
| `gift` | received (single step) | No |
| `digital_purchase` | purchased (single step) | No |
| `auction` | bid → won → shipped → delivered | Yes |
| `event_purchase` | purchased (single step) | No |

The order status enum must accommodate both multi-step and single-step flows.

## Schema Changes

### New enum: `order_status`
```
placed | confirmed | processing | shipped | in_transit | out_for_delivery | delivered | purchased | received | bid | won | cancelled | returned
```

### New enum: `acquisition_method`
```
online_order | in_store_purchase | gift | digital_purchase | auction | event_purchase
```

### New table: `orders`

```
orders
  id                        uuid, PK, default random
  workId                    uuid, FK → works, NOT NULL, CASCADE
  editionId                 uuid, FK → editions, nullable
  instanceId                uuid, FK → instances, nullable    -- linked post-delivery
  venueId                   uuid, FK → venues, nullable       -- Task 0061 (bookshop, online store, etc.)

  -- Order identity
  acquisitionMethod         text, NOT NULL                    -- acquisition_method enum
  status                    text, NOT NULL, default 'placed'  -- order_status enum

  -- Order details
  orderDate                 date, NOT NULL
  orderConfirmation         text                              -- order/confirmation number
  orderUrl                  text                              -- link to order page (Amazon order, etc.)

  -- Pricing
  price                     numeric(10,2)
  shippingCost              numeric(10,2)
  totalCost                 numeric(10,2)                     -- price + shipping + tax
  currency                  text                              -- ISO 4217

  -- Shipping (only for shipped methods)
  carrier                   text                              -- "Amazon Logistics", "DHL", "UPS", "Royal Mail", etc.
  trackingNumber            text
  trackingUrl               text                              -- direct tracking link (Amazon tracking page, DHL URL, etc.)
  shippedDate               date
  estimatedDeliveryDate     date
  actualDeliveryDate        date

  -- Origin and destination
  originDescription         text                              -- free text: "Strand Bookstore, NYC"
  originPlaceId             uuid, FK → places, nullable       -- geographic origin (Task 0059)
  destinationLocationId     uuid, FK → locations              -- target shelf/location
  destinationSubLocationId  uuid, FK → sub_locations, nullable

  -- Notes
  notes                     text                              -- max 5000

  createdAt                 timestamptz, default now()
  updatedAt                 timestamptz
```

### New table: `order_status_history`

```
order_status_history
  id          uuid, PK
  orderId     uuid, FK → orders, CASCADE
  fromStatus  text, nullable
  toStatus    text, NOT NULL
  changedAt   timestamptz, default now()
  notes       text                          -- "Tracking number received", "Delayed by customs", etc.
```

## Provenance Page Layout

### URL: `/provenance`
Added to main navigation bar alongside Library, Authors, etc.

### Section 1: KPI Summary Cards (top)
Quick-glance metrics:
- **In Transit**: count of orders with `status IN (shipped, in_transit, out_for_delivery)`
- **Arriving This Week**: orders with `estimatedDeliveryDate` within 7 days, with book posters as tiny thumbnails
- **Total Spent (period)**: sum of `totalCost`, filterable by month/quarter/year/all-time
- **Avg Delivery Time**: mean days from `orderDate` to `actualDeliveryDate` for completed orders
- **Active Orders**: total non-terminal orders
- **Top Source**: most-used venue in selected period

### Section 2: Active Pipeline (main visual)
A horizontal pipeline/kanban visualization showing all active orders by status stage.

**For shipped orders** (`online_order`, `auction`):
```
Placed → Confirmed → Shipped → In Transit → Out for Delivery → Delivered
```

**For immediate acquisitions** (`in_store_purchase`, `gift`, `digital_purchase`, `event_purchase`):
These appear in a separate "Recent Acquisitions" lane or skip the pipeline entirely and go straight to the timeline.

**Each order card in the pipeline shows:**
- Book poster (from work's active media) -- this is the primary visual identifier
- Title + author name
- Venue name + icon
- Estimated delivery date (for shipped items)
- Days since order / days in current stage
- Price
- Subtle status color indicator

**Interactions:**
- Drag and drop to advance status (or click to update)
- Click card to expand full order detail
- Filter pipeline by venue, date range, destination

### Section 3: Order Detail Drawer/Panel
When clicking an order card, a side drawer or expandable panel shows:
- **Large book poster** (from work media)
- Title, author, edition details (ISBN, publisher if known)
- **Order timeline**: vertical timeline of all status changes from `order_status_history`, with timestamps and notes
- Venue info with link to website
- Shipping: carrier, tracking number (clickable), estimated vs actual delivery
- Origin → Destination visual (location names, optional map snippet)
- Price breakdown (item + shipping + total)
- Notes
- Actions: update status, edit order, cancel, link to instance (on delivery)

### Section 4: Acquisition Timeline (scrollable)
Vertical timeline of all completed acquisitions (delivered, purchased, received):
- Grouped by month/year
- Each entry: date, book poster, title, author, vendor, price
- Infinite scroll for history
- Filterable by date range, vendor, acquisition method, price range

### Section 5: Spending Analytics
Charts and visualizations:
- Spending over time (line/area chart, monthly)
- Spending by venue (horizontal bar chart)
- Spending by currency (if multi-currency)
- Acquisition method breakdown (donut chart)
- Books per month acquisition rate

### Section 6: Geographic Flow (optional, if `originPlaceId` data available)
Mini-map showing arc lines from origin locations to destination locations. Reuses Mapbox setup from Task 0058.

## Order Creation Flow (on Provenance page)

1. Click "New Order" button on the Provenance page
2. **Select work**: autocomplete search (shows poster + title + author)
3. **Select edition** (optional): dropdown of editions for that work
4. **Acquisition method**: dropdown (online_order, in_store_purchase, gift, etc.)
5. **Venue** (acquisition source): autocomplete field
   - Searches existing venues first
   - "Search with Google Places..." triggers API (Task 0061)
   - "Add manually" for custom entry
6. **Order details**: conditional fields based on acquisition method
   - Online order: order date, confirmation #, order URL, carrier, tracking, estimated delivery, destination location
   - In-store purchase: purchase date, destination location (auto-set to current location?)
   - Gift: received date, from whom (vendor or free text), destination location
7. **Pricing**: price, shipping, currency
8. **Notes**: free text
9. Save → order appears in pipeline

## Delivery → Instance Flow

When an order reaches `delivered` status:
1. System prompts: "Create instance for this delivery?"
2. Pre-fills instance form with:
   - `editionId` from order (if set)
   - `locationId` from order's destination
   - `acquisitionType` from order's `acquisitionMethod`
   - `acquisitionDate` = `actualDeliveryDate`
   - `acquisitionSource` = venue name
   - `acquisitionPrice` = order price
   - `acquisitionCurrency` = order currency
3. User confirms/adjusts → instance created
4. `order.instanceId` linked to new instance
5. Work's `catalogueStatus` transitions to `accessioned` (with `work_status_history` entry)

For immediate acquisitions (in-store, gift):
- Instance can be created immediately as part of the order creation flow
- Single-step: create order + create instance in one form

## Book Detail Page Integration
On a work's detail page, show a "Provenance" section (read-only):
- List of orders associated with this work
- Order status badges
- Link to "View on Provenance page" for full management
- No inline order editing -- all management on Provenance page

## Visualization Libraries
- **Pipeline/kanban**: Custom implementation with CSS Grid + Framer Motion animations
- **Timeline**: Custom SVG/HTML with scroll-triggered animations
- **Charts**: Recharts or Nivo (styled dark to match design language)
- **Geographic flow**: Mapbox GL JS (reuse from Task 0058)
- All colors must be from the app's muted palette -- no default chart library colors

## Server Actions
- `createOrder(input)`
- `updateOrder(id, input)`
- `updateOrderStatus(id, newStatus, notes?)`
- `deleteOrder(id)` -- only non-delivered
- `cancelOrder(id, notes?)`
- `getActiveOrders(filters?)`
- `getOrdersForWork(workId)`
- `getOrderTimeline(filters, pagination)`
- `getProvenanceStats(dateRange?)`
- `linkOrderToInstance(orderId, instanceId)`
- `createOrderWithInstance(input)` -- for immediate acquisitions

## Migration Plan
1. Create `order_status` and `acquisition_method` enums
2. Create `orders` table
3. Create `order_status_history` table
4. Update `docs/02_DATA_MODEL.md`
5. No backfill -- existing accessioned items will be re-entered manually by the user
