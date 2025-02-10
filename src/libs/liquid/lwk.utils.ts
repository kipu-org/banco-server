import { Network, Wollet, WolletDescriptor } from 'lwk_wasm';

export const getWalletFromDescriptor = (descriptor: string): Wollet => {
  const network = Network.mainnet();
  const wolletDescriptor = new WolletDescriptor(descriptor);

  return new Wollet(network, wolletDescriptor);
};

export const isTxId = (str: string) => {
  const pattern = /[0-9a-fA-F]{64}/;

  return pattern.test(str);
};
