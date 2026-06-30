-- Удаление денормализованной колонки products.price.
-- Продажная цена теперь хранится только в таблице «Цены» (product_prices),
-- тип «по умолчанию»; автоподстановка идёт через product-prices/price-list.
-- Значение восстановимо из product_prices, поэтому потеря денорм-кэша безопасна.
ALTER TABLE "products" DROP COLUMN "price";
