import { NumberDictionary, uniqueNamesGenerator } from 'unique-names-generator';

import { bip39 } from './bip39';
import { fruits } from './fruitList';

export const generateFruitName = () => {
  return uniqueNamesGenerator({
    dictionaries: [fruits],
    style: 'capital',
    length: 1,
  });
};

export const generateMoneyAddress = () => {
  const numberDictionary = NumberDictionary.generate({ min: 1000, max: 9999 });

  return uniqueNamesGenerator({
    dictionaries: [bip39, numberDictionary],
    separator: '',
    style: 'lowerCase',
    length: 2,
  });
};
