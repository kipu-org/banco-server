import { Network, Wollet, WolletDescriptor } from 'lwk_node';

export const getWalletFromDescriptor = (descriptor: string): Wollet => {
  const network = Network.mainnet();
  const wolletDescriptor = new WolletDescriptor(descriptor);

  return new Wollet(network, wolletDescriptor);
};
