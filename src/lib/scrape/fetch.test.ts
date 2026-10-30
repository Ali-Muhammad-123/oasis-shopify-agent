import { describe, expect, it } from 'vitest';
import { canonicalUrl, isBotInterstitial, isPrivateAddress } from './fetch';

describe('isPrivateAddress', () => {
  it('blocks loopback, private, link-local, CGNAT and metadata ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '54.239.28.85', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('canonicalUrl', () => {
  it('reduces Amazon product links to /dp/ASIN', () => {
    expect(canonicalUrl('https://www.amazon.com/TrixHub-Flashlights/dp/B0DJQF83C2/ref=sr_1_2?dib=x&keywords=torch')).toBe('https://www.amazon.com/dp/B0DJQF83C2');
    expect(canonicalUrl('https://www.amazon.co.uk/gp/product/b0djqf83c2?th=1')).toBe('https://www.amazon.co.uk/dp/B0DJQF83C2');
    expect(canonicalUrl('https://www.amazon.com/clp/B0DJQF83C2')).toBe('https://www.amazon.com/dp/B0DJQF83C2');
  });
  it('leaves other links alone', () => {
    expect(canonicalUrl('https://shop.example.com/products/mug?variant=1')).toBe('https://shop.example.com/products/mug?variant=1');
  });
});

describe('isBotInterstitial', () => {
  it('spots small bot-check pages but not real product pages', () => {
    expect(isBotInterstitial('<p>Click the button below to continue shopping</p>')).toBe(true);
    expect(isBotInterstitial('<span id="productTitle">x</span>' + 'a'.repeat(30_000) + 'captcha')).toBe(false);
  });
});
