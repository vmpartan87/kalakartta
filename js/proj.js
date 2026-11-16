// ETRS-TM35FIN (EPSG:3067) <-> WGS84, Krügerin sarjat.
export const TM=(()=>{const a=6378137,f=1/298.257222101,k0=0.9996,E0=500000,l0=27*Math.PI/180;
const n=f/(2-f),n2=n*n,n3=n2*n,A=a/(1+n)*(1+n2/4+n2*n2/64);
const al=[n/2-2*n2/3+5*n3/16,13*n2/48-3*n3/5,61*n3/240],be=[n/2-2*n2/3+37*n3/96,n2/48+n3/15,17*n3/480],de=[2*n-2*n2/3-2*n3,7*n2/3-8*n3/5,56*n3/15];
const c=2*Math.sqrt(n)/(1+n);
return{fwd(lon,lat){const p=lat*Math.PI/180,dl=lon*Math.PI/180-l0;const t=Math.sinh(Math.atanh(Math.sin(p))-c*Math.atanh(c*Math.sin(p)));
const xi=Math.atan(t/Math.cos(dl)),eta=Math.atanh(Math.sin(dl)/Math.sqrt(1+t*t));let x=eta,y=xi;
for(let j=1;j<=3;j++){x+=al[j-1]*Math.cos(2*j*xi)*Math.sinh(2*j*eta);y+=al[j-1]*Math.sin(2*j*xi)*Math.cosh(2*j*eta)}
return[E0+k0*A*x,k0*A*y]},
inv(E,N){const xi=N/(k0*A),eta=(E-E0)/(k0*A);let xp=xi,ep=eta;
for(let j=1;j<=3;j++){xp-=be[j-1]*Math.sin(2*j*xi)*Math.cosh(2*j*eta);ep-=be[j-1]*Math.cos(2*j*xi)*Math.sinh(2*j*eta)}
const chi=Math.asin(Math.sin(xp)/Math.cosh(ep));let p=chi;for(let j=1;j<=3;j++)p+=de[j-1]*Math.sin(2*j*chi);
return[(l0+Math.atan(Math.sinh(ep)/Math.cos(xp)))*180/Math.PI,p*180/Math.PI]}}})();
