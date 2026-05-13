export const uniqBy = <T>(arr: T[], predicate: (keyof T) | ((o: T, i: number) => unknown)) => {
  const cb = typeof predicate === 'function' ? predicate : (o: T) => o[predicate];

  return [...arr.reduce((map, item, i) => {
    const key = (item === null || item === undefined) ?
      item : cb(item, i);

    map.has(key) || map.set(key, item);

    return map;
  }, new Map()).values()];
};

export const groupBy = <T>(arr: T[], predicate: (keyof T) | ((o: T, i: number) => string | number)) => {
  return arr.reduce((acc, item, i) => {
    const cb = typeof predicate === 'function' ? predicate : (o: T) => String(o[predicate]);
    const key = cb(item, i);
    
    if (!acc[key]) {
      acc[key] = [];
    }
    
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[] | undefined>);
};
