export function formatNumber(num: number): string {
    if (num === 0) return '0';
    
    const absNum = Math.abs(num);
    if (absNum >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    } else if (absNum >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    } else if (absNum >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    } else if (absNum < 1) {
        return num.toFixed(6);
    }
    
    return num.toLocaleString();
}

export function formatPrice(price: number): string {
    if (price === 0) return '$0';
    
    if (price < 0.000001) {
        return `$${price.toExponential(2)}`;
    } else if (price < 1) {
        return `$${price.toFixed(6)}`;
    } else if (price < 1000) {
        return `$${price.toFixed(2)}`;
    }
    
    return `$${formatNumber(price)}`;
}

export function formatUSD(amount: number): string {
    if (amount === 0) return '$0';
    
    const absAmount = Math.abs(amount);
    if (absAmount >= 1e9) {
        return `$${(amount / 1e9).toFixed(2)}B`;
    } else if (absAmount >= 1e6) {
        return `$${(amount / 1e6).toFixed(2)}M`;
    } else if (absAmount >= 1e3) {
        return `$${(amount / 1e3).toFixed(2)}K`;
    }
    
    return `$${amount.toFixed(2)}`;
}
