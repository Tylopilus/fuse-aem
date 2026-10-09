package com.acme.components.stockticker;

import java.util.concurrent.CompletableFuture;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;

@Model(
    adaptables = {SlingHttpServletRequest.class, Resource.class},
    defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class StockTickerModel extends StockTickerProps {

    public static class StockQuotes {
        private final String symbol;
        private final double price;
        private final double change;

        public StockQuotes(String symbol, double price, double change) {
            this.symbol = symbol;
            this.price = price;
            this.change = change;
        }

        public String getSymbol() {
            return symbol;
        }

        public double getPrice() {
            return price;
        }

        public double getChange() {
            return change;
        }

        public boolean isPositive() {
            return change >= 0;
        }
    }

    public CompletableFuture<StockQuotes> getQuotes() {
        String sym = getSymbol() != null ? getSymbol() : "ADBE";
        return async("quotes", () -> {
            // Simulate external financial API latency (non-blocking for HTTP thread)
            try {
                Thread.sleep(60);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return new StockQuotes(sym, 520.45, +4.82);
        });
    }
}
