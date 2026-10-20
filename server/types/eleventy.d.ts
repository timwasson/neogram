declare module '@11ty/eleventy' {
  export default class Eleventy {
    constructor(input?: string, output?: string, options?: any);
    write(): Promise<any>;
    [key: string]: any;
  }
}
