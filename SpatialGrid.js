// Static circles occupy every cell their influence touches. Query order matches source order.
export class CircleGrid {
  constructor(size=8,margin=.55){this.size=size;this.margin=margin;this.cells=new Map();this.source=null;this.count=-1;}
  rebuild(source){
    this.source=source;this.count=source.length;this.cells.clear();
    source.forEach(o=>{const r=o.r+this.margin;
      for(let x=Math.floor((o.x-r)/this.size);x<=Math.floor((o.x+r)/this.size);x++)
        for(let z=Math.floor((o.z-r)/this.size);z<=Math.floor((o.z+r)/this.size);z++){
          const key=x+','+z;let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=[]);cell.push(o);
        }
    });
  }
  query(source,x,z){if(this.source!==source||this.count!==source.length)this.rebuild(source);
    return this.cells.get(Math.floor(x/this.size)+','+Math.floor(z/this.size))||EMPTY;
  }
}
const EMPTY=Object.freeze([]);
