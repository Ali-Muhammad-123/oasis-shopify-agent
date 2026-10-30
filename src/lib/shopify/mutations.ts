// Admin GraphQL operations used by the agent's write tools (each runs only after user approval)
// and by their previews. Validated with: pnpm validate:graphql

export const DISCOUNT_CODE_BASIC_CREATE = /* GraphQL */ `
  mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic { title status codes(first: 1) { nodes { code } } } } }
      userErrors { field message }
    }
  }
`;

export const DISCOUNT_CODE_EXISTS = /* GraphQL */ `
  query DiscountCodeExists($code: String!) {
    codeDiscountNodeByCode(code: $code) { id }
  }
`;

export const VARIANTS_FOR_PREVIEW = /* GraphQL */ `
  query VariantsForPreview($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id title sku price compareAtPrice inventoryQuantity
        product { id title }
        inventoryItem { id unitCost { amount } }
      }
    }
  }
`;

export const PRODUCT_VARIANTS_BULK_UPDATE = /* GraphQL */ `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

export const PRODUCT_FOR_PREVIEW = /* GraphQL */ `
  query ProductForPreview($id: ID!) {
    product(id: $id) { id title status tags vendor productType }
  }
`;

export const PRODUCT_UPDATE = /* GraphQL */ `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id title status tags vendor productType }
      userErrors { field message }
    }
  }
`;

export const INVENTORY_LEVEL_FOR_PREVIEW = /* GraphQL */ `
  query InventoryLevelForPreview($variantId: ID!, $locationId: ID!) {
    productVariant(id: $variantId) {
      id title sku
      product { title }
      inventoryItem {
        id tracked
        inventoryLevel(locationId: $locationId) {
          location { id name }
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }
`;

// Since 2026-04 inventory mutations require an idempotency key, and each change carries
// changeFromQuantity (compare-and-swap against the quantity shown in the approval preview).
export const INVENTORY_ADJUST_QUANTITIES = /* GraphQL */ `
  mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange location { name } } }
      userErrors { field message }
    }
  }
`;

export const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
  }
`;

export const TAGS_REMOVE = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } }
  }
`;

export const NODE_LABEL = /* GraphQL */ `
  query NodeLabel($id: ID!) {
    node(id: $id) {
      id
      ... on Order { name tags }
      ... on Customer { displayName tags }
      ... on Product { title tags }
      ... on DraftOrder { name tags }
    }
  }
`;

export const DRAFT_ORDER_CREATE = /* GraphQL */ `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id name invoiceUrl totalPriceSet { shopMoney { amount currencyCode } } }
      userErrors { field message }
    }
  }
`;

export const ORDER_FOR_PREVIEW = /* GraphQL */ `
  query OrderForPreview($id: ID!) {
    order(id: $id) {
      id name cancelledAt displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { displayName }
      fulfillmentOrders(first: 5) { nodes { id status lineItems(first: 20) { nodes { remainingQuantity lineItem { title } } } } }
    }
  }
`;

export const ORDER_CANCEL = /* GraphQL */ `
  mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput, $staffNote: String) {
    orderCancel(orderId: $orderId, reason: $reason, restock: $restock, notifyCustomer: $notifyCustomer, refundMethod: $refundMethod, staffNote: $staffNote) {
      job { id done }
      orderCancelUserErrors { field message code }
    }
  }
`;

export const FULFILLMENT_CREATE = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status trackingInfo { company number url } }
      userErrors { field message }
    }
  }
`;

export const THEMES = /* GraphQL */ `
  query Themes {
    themes(first: 20, roles: [MAIN, UNPUBLISHED]) { nodes { id name role } }
  }
`;

export const THEME_DUPLICATE = /* GraphQL */ `
  mutation ThemeDuplicate($id: ID!, $name: String) {
    themeDuplicate(id: $id, name: $name) {
      newTheme { id name role }
      userErrors { field message }
    }
  }
`;

export const THEME_FILES_UPSERT = /* GraphQL */ `
  mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      job { id done }
      userErrors { field message code }
    }
  }
`;

export const PAGE_BY_HANDLE = /* GraphQL */ `
  query PageByHandle($query: String!) {
    pages(first: 1, query: $query) { nodes { id handle title templateSuffix } }
  }
`;

export const PAGE_CREATE = /* GraphQL */ `
  mutation PageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id handle title templateSuffix }
      userErrors { field message code }
    }
  }
`;

export const PAGE_UPDATE = /* GraphQL */ `
  mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page { id handle title templateSuffix }
      userErrors { field message code }
    }
  }
`;

export const PRODUCT_SET_CREATE = /* GraphQL */ `
  mutation ProductSetCreate($input: ProductSetInput!) {
    productSet(synchronous: true, input: $input) {
      product {
        id handle title status onlineStoreUrl
        media(first: 20) { nodes { id status mediaContentType } }
        variants(first: 50) { nodes { id sku price } }
      }
      userErrors { field message code }
    }
  }
`;

export const PUBLICATIONS = /* GraphQL */ `
  query Publications {
    publications(first: 20) { nodes { id catalog { title } } }
  }
`;

export const PUBLISHABLE_PUBLISH = /* GraphQL */ `
  mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

export const PRODUCT_FOR_PDP = /* GraphQL */ `
  query ProductForPdp($id: ID!) {
    product(id: $id) {
      id title handle vendor productType tags descriptionHtml templateSuffix onlineStoreUrl
      options { name values }
      media(first: 20) { nodes { ... on MediaImage { image { url altText width height } } } }
      variants(first: 20) { nodes { id title sku price compareAtPrice availableForSale } }
      metafields(first: 20, namespace: "oasis") { nodes { key value } }
    }
  }
`;

export const THEME_FILES = /* GraphQL */ `
  query ThemeFiles($id: ID!, $filenames: [String!]!) {
    theme(id: $id) {
      files(filenames: $filenames, first: 5) {
        nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
      }
    }
  }
`;

export const PRODUCT_TEMPLATE_SET = /* GraphQL */ `
  mutation ProductTemplateSet($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id handle templateSuffix }
      userErrors { field message }
    }
  }
`;

// ---- Customer segments --------------------------------------------------------------------

export const SEGMENT_CREATE = /* GraphQL */ `
  mutation SegmentCreate($name: String!, $query: String!) {
    segmentCreate(name: $name, query: $query) {
      segment { id name query }
      userErrors { field message }
    }
  }
`;

export const SEGMENT_DELETE = /* GraphQL */ `
  mutation SegmentDelete($id: ID!) {
    segmentDelete(id: $id) { deletedSegmentId userErrors { field message } }
  }
`;

export const SEGMENTS = /* GraphQL */ `
  query Segments($first: Int!) {
    segments(first: $first, sortKey: CREATION_DATE, reverse: true) { nodes { id name query creationDate } }
  }
`;

export const SEGMENT_MEMBERS = /* GraphQL */ `
  query SegmentMembers($query: String, $segmentId: ID, $first: Int!, $after: String) {
    customerSegmentMembers(query: $query, segmentId: $segmentId, first: $first, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id displayName firstName lastName numberOfOrders
          defaultEmailAddress { emailAddress marketingState }
          amountSpent { amount currencyCode }
        }
      }
    }
  }
`;

// ---- Costs, undo helpers --------------------------------------------------------------------

export const INVENTORY_ITEM_UPDATE = /* GraphQL */ `
  mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id unitCost { amount currencyCode } }
      userErrors { field message }
    }
  }
`;

export const DISCOUNT_CODE_DELETE = /* GraphQL */ `
  mutation DiscountCodeDelete($id: ID!) {
    discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } }
  }
`;

export const DRAFT_ORDER_DELETE = /* GraphQL */ `
  mutation DraftOrderDelete($input: DraftOrderDeleteInput!) {
    draftOrderDelete(input: $input) { deletedId userErrors { field message } }
  }
`;

export const PRODUCT_DELETE = /* GraphQL */ `
  mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { field message } }
  }
`;

// ---- Bulk operations ----------------------------------------------------------------------

export const BULK_PRODUCTS = /* GraphQL */ `
  query BulkProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes { id title variants(first: 100) { nodes { id title sku price compareAtPrice } } }
    }
  }
`;

export const CUSTOMER_TAGS = /* GraphQL */ `
  query CustomerTags($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Customer { id displayName tags } }
  }
`;
