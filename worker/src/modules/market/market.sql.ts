/** Every listing column, plus the seller's and leading bidder's names. */
const LISTING_SELECT = `
  SELECT l.id, l.seller_id, s.display_name AS seller_name, l.type, l.status, l.item_id,
         l.source_inventory_id, l.charges_left, l.reforge, l.pet, l.obtained_at, l.quantity_listed, l.quantity_left,
         l.unit_price, l.starting_bid, l.current_bid, l.leading_bidder_id,
         b.display_name AS leading_bidder_name, l.bid_count, l.ends_at, l.fee_paid,
         l.proceeds, l.proceeds_collected, l.created_at
  FROM market_listings l
  JOIN players s ON s.id = l.seller_id
  LEFT JOIN players b ON b.id = l.leading_bidder_id
`;

/** Live single items (stacks have no source copy), newest first. Walks `market_listings_singles`. */
export const FIND_ACTIVE_SINGLES = `
  ${LISTING_SELECT}
  WHERE l.status = 'active' AND l.source_inventory_id IS NOT NULL
  ORDER BY l.created_at DESC
  LIMIT 500;
`;

/** Live stack offers of the stackables `?1` (JSON) from everyone but the viewer `?2`, pooled per item and price. */
export const FIND_STACK_OFFERS = `
  SELECT item_id, unit_price, sum(quantity_left) AS quantity
  FROM market_listings
  WHERE status = 'active' AND type = 'bin' AND item_id IN (SELECT value FROM json_each(?1)) AND seller_id <> ?2
  GROUP BY item_id, unit_price
  ORDER BY item_id, unit_price;
`;

/** The seller's live listings, and ended ones with coins still to collect. Uses `market_listings_seller`. */
export const FIND_OWN_LISTINGS = `
  ${LISTING_SELECT}
  WHERE l.seller_id = ? AND (l.status = 'active' OR l.proceeds > l.proceeds_collected)
  ORDER BY l.created_at DESC;
`;

export const FIND_LISTING = `${LISTING_SELECT} WHERE l.id = ?;`;

export const COUNT_ACTIVE_FOR_SELLER = `
  SELECT count(*) AS count FROM market_listings WHERE seller_id = ? AND status = 'active';
`;

export const INSERT_LISTING = `
  INSERT INTO market_listings
    (id, seller_id, type, item_id, source_inventory_id, charges_left, obtained_at,
     quantity_listed, quantity_left, unit_price, starting_bid, ends_at, fee_paid, reforge, pet, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15);
`;

/** The bids on listings `?` (JSON ids), oldest first. */
export const FIND_BIDS = `
  SELECT g.listing_id, p.display_name AS bidder_name, g.amount, g.created_at
  FROM market_bids g JOIN players p ON p.id = g.bidder_id
  WHERE g.listing_id IN (SELECT value FROM json_each(?))
  ORDER BY g.created_at, g.id;
`;

/** The sales of listings `?` (JSON ids), oldest first. */
export const FIND_SALES = `
  SELECT s.listing_id, p.display_name AS buyer_name, s.quantity, s.paid, s.created_at
  FROM market_sales s LEFT JOIN players p ON p.id = s.buyer_id
  WHERE s.listing_id IN (SELECT value FROM json_each(?))
  ORDER BY s.created_at, s.id;
`;

export const SUM_HELD_FOR_BIDDER = `
  SELECT coalesce(sum(amount), 0) AS held FROM market_bids WHERE bidder_id = ? AND status = 'held';
`;

export const INSERT_BID = `
  INSERT INTO market_bids (listing_id, bidder_id, amount, created_at) VALUES (?, ?, ?, ?);
`;

/** The held bid on listing `?1`, marked `?2` (returned or won). Returns who held it and how much. */
export const SETTLE_HELD_BID = `
  UPDATE market_bids SET status = ?2 WHERE listing_id = ?1 AND status = 'held'
  RETURNING bidder_id, amount;
`;

/** Listing `?1`: bid `?2` by `?3`, ending at `?4`. */
export const SET_LEADING_BID = `
  UPDATE market_listings
  SET current_bid = ?2, leading_bidder_id = ?3, bid_count = bid_count + 1, ends_at = ?4
  WHERE id = ?1;
`;

export const INSERT_SALE = `
  INSERT INTO market_sales (listing_id, buyer_id, quantity, paid, created_at) VALUES (?, ?, ?, ?, ?);
`;

/** Takes `?2` units out of escrow of listing `?1` for `?3` coins (now `?4`); the listing is sold once none are left. */
export const RECORD_SALE = `
  UPDATE market_listings
  SET quantity_left = quantity_left - ?2,
      proceeds = proceeds + ?3,
      status = CASE WHEN quantity_left - ?2 = 0 THEN 'sold' ELSE status END,
      ended_at = CASE WHEN quantity_left - ?2 = 0 THEN ?4 ELSE ended_at END
  WHERE id = ?1;
`;

/** Ends listing `?1` as `?2` (at `?3`) without a sale; whatever is left in escrow has been handed back. */
export const END_LISTING = `
  UPDATE market_listings SET status = ?2, quantity_left = 0, ended_at = ?3 WHERE id = ?1;
`;

export const MARK_COLLECTED = `UPDATE market_listings SET proceeds_collected = proceeds WHERE id = ?;`;

export const FIND_UNCOLLECTED_IDS = `
  SELECT id FROM market_listings WHERE seller_id = ? AND proceeds > proceeds_collected;
`;

/**
 * The cheapest live offers of item `?1` from sellers other than `?2`, as
 * many as it takes to reach `?3` units, cheapest (then oldest) first.
 */
export const FIND_CHEAPEST_STACK_LISTINGS = `
  SELECT id, seller_id, unit_price, quantity_left FROM (
    SELECT id, seller_id, unit_price, quantity_left, created_at,
           sum(quantity_left) OVER (ORDER BY unit_price, created_at, id) - quantity_left AS before
    FROM market_listings
    WHERE status = 'active' AND type = 'bin' AND item_id = ?1 AND seller_id <> ?2
  )
  WHERE before < ?3
  ORDER BY unit_price, created_at, id;
`;

/** Auctions whose time (`?1`) is up, oldest first. Uses `market_listings_ending`. */
export const FIND_ENDED_AUCTION_IDS = `
  SELECT id FROM market_listings
  WHERE status = 'active' AND type = 'auction' AND ends_at <= ?1
  ORDER BY ends_at
  LIMIT 200;
`;

/** Admin's economy page: every coin bids hold right now. */
export const SUM_HELD_ALL = `SELECT coalesce(sum(amount), 0) AS total FROM market_bids WHERE status = 'held';`;

/** Admin's economy page: every coin sellers haven't collected. */
export const SUM_UNCOLLECTED_ALL = `
  SELECT coalesce(sum(proceeds - proceeds_collected), 0) AS total FROM market_listings;
`;
