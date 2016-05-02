//Priprava knjižnic
var formidable = require("formidable");
var util = require('util');

if (!process.env.PORT)
  process.env.PORT = 8080;

// Priprava povezave na podatkovno bazo
var sqlite3 = require('sqlite3').verbose();
var pb = new sqlite3.Database('chinook.sl3');

// Priprava strežnika
var express = require('express');
/* express na strezniski strani poskrbi za celotno hranjenje seje -
   mi moramo vedeti, da ko mi v .get / .post funkcijo dobimo zahtevo ter
   podamo odgovor je nivo nizje se express-session nivo, ki skrbi za pravi
   kontekst.
   Ta namrec ob prvi povezavi
   novega odjemalca ustvari sejo in ji poda identifikator - tega poda
   nazaj odjemalcu v obliki piskotka in ob vsaki naslednji povezavi
   odjemalec ta isti piskotek poda strezniku, da ga ta lahko ta ponovno
   poveze z njegovo sejo (HTML sam po sebi je namrec stateless, zato pa imamo
   piskote).
   
   Vsi podatki se hranijo na strani streznika - objekt, ki pripada
   trenutni seji, se lahko pridobi preko zahteva.session
*/
var expressSession = require('express-session');
var streznik = express();
streznik.set('view engine', 'ejs');
streznik.use(express.static('public'));
streznik.use(
  expressSession({
    secret: '1234567890QWERTY', // Skrivni ključ za podpisovanje piškotkov
    saveUninitialized: true,    // Novo sejo shranimo
    resave: false,              // Ne zahtevamo ponovnega shranjevanja
    cookie: {
      maxAge: 3600000           // Seja poteče po 60min neaktivnosti
    }
  })
);

var razmerje_usd_eur = 0.877039116;

function davcnaStopnja(izvajalec, zanr) {
  switch (izvajalec) {
    case "Queen": case "Led Zepplin": case "Kiss":
      return 0;
    case "Justin Bieber":
      return 22;
    default:
      break;
  }
  switch (zanr) {
    case "Metal": case "Heavy Metal": case "Easy Listening":
      return 0;
    default:
      return 9.5;
  }
}

// Prikaz seznama pesmi na strani
streznik.get('/', function(zahteva, odgovor) {
  /* mi bomo znotraj trenutne seje hranili se identifikator uporabnika
     (primarni kljuc, ki se uporabi znotraj podatkovne baze), da bomo kosarico
     seje povezali z uporabnikom.
     - ce ta se ni dolocen, preusmerimo na prijavo */
  if(!zahteva.session.uporabnik)
    odgovor.redirect('/prijava');
  else
  {
    pb.all("SELECT Track.TrackId AS id, Track.Name AS pesem, \
            Artist.Name AS izvajalec, Track.UnitPrice * " +
            razmerje_usd_eur + " AS cena, \
            COUNT(InvoiceLine.InvoiceId) AS steviloProdaj, \
            Genre.Name AS zanr \
            FROM Track, Album, Artist, InvoiceLine, Genre \
            WHERE Track.AlbumId = Album.AlbumId AND \
            Artist.ArtistId = Album.ArtistId AND \
            InvoiceLine.TrackId = Track.TrackId AND \
            Track.GenreId = Genre.GenreId \
            GROUP BY Track.TrackId \
            ORDER BY steviloProdaj DESC, pesem ASC \
            LIMIT 100", function(napaka, vrstice) {
      if (napaka)
        odgovor.sendStatus(500);
      else {
          for (var i=0; i<vrstice.length; i++)
            vrstice[i].stopnja = davcnaStopnja(vrstice[i].izvajalec, vrstice[i].zanr);
          odgovor.render('seznam', {seznamPesmi: vrstice});
        }
    })
  }
})

// Dodajanje oz. brisanje pesmi iz košarice
streznik.get('/kosarica/:idPesmi', function(zahteva, odgovor) {
  var idPesmi = parseInt(zahteva.params.idPesmi);
  if (!zahteva.session.kosarica)
    zahteva.session.kosarica = [];
  if (zahteva.session.kosarica.indexOf(idPesmi) > -1) {
    zahteva.session.kosarica.splice(zahteva.session.kosarica.indexOf(idPesmi), 1);
  } else {
    zahteva.session.kosarica.push(idPesmi);
  }
  
  odgovor.send(zahteva.session.kosarica);
});

// Vrni podrobnosti pesmi v košarici iz podatkovne baze
var pesmiIzKosarice = function(zahteva, callback) {
  if (!zahteva.session.kosarica || Object.keys(zahteva.session.kosarica).length == 0) {
    callback([]);
  } else {
    pb.all("SELECT Track.TrackId AS stevilkaArtikla, 1 AS kolicina, \
    Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
    Track.UnitPrice * " + razmerje_usd_eur + " AS cena, 0 AS popust, \
    Genre.Name AS zanr \
    FROM Track, Album, Artist, Genre \
    WHERE Track.AlbumId = Album.AlbumId AND \
    Artist.ArtistId = Album.ArtistId AND \
    Track.GenreId = Genre.GenreId AND \
    Track.TrackId IN (" + zahteva.session.kosarica.join(",") + ")",
    function(napaka, vrstice) {
      if (napaka) {
        callback(false);
      } else {
        for (var i=0; i<vrstice.length; i++) {
          vrstice[i].stopnja = davcnaStopnja((vrstice[i].opisArtikla.split(' (')[1]).split(')')[0], vrstice[i].zanr);
        }
        callback(vrstice);
      }
    })
  }
}

streznik.get('/kosarica', function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi)
      odgovor.sendStatus(500);
    else
      odgovor.send(pesmi);
  });
})

// Vrni podrobnosti pesmi na računu
var pesmiIzRacuna = function(racunId, callback) {
    pb.all("SELECT Track.TrackId AS stevilkaArtikla, 1 AS kolicina, \
    Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
    Track.UnitPrice * " + razmerje_usd_eur + " AS cena, 0 AS popust, \
    Genre.Name AS zanr \
    FROM Track, Album, Artist, Genre \
    WHERE Track.AlbumId = Album.AlbumId AND \
    Artist.ArtistId = Album.ArtistId AND \
    Track.GenreId = Genre.GenreId AND \
    Track.TrackId IN (SELECT InvoiceLine.TrackId FROM InvoiceLine, Invoice \
    WHERE InvoiceLine.InvoiceId = Invoice.InvoiceId AND Invoice.InvoiceId = " + racunId + ")",
    function(napaka, vrstice) {
      console.log(vrstice);
    })
}

// Vrni podrobnosti o stranki iz računa
var strankaIzRacuna = function(racunId, callback) {
    pb.all("SELECT Customer.* FROM Customer, Invoice \
            WHERE Customer.CustomerId = Invoice.CustomerId AND Invoice.InvoiceId = " + racunId,
    function(napaka, vrstice) {
      console.log(vrstice);
    })
}

// Izpis računa v HTML predstavitvi na podlagi podatkov iz baze
streznik.post('/izpisiRacunBaza', function(zahteva, odgovor) {
  odgovor.end();
})

// Izpis računa v HTML predstavitvi ali izvorni XML obliki
streznik.get('/izpisiRacun/:oblika', function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi) {
      odgovor.sendStatus(500);
    } else if (pesmi.length == 0) {
      odgovor.send("<p>V košarici nimate nobene pesmi, \
        zato računa ni mogoče pripraviti!</p>");
    } else {
      odgovor.setHeader('content-type', 'text/xml');
      odgovor.render('eslog', {
        vizualiziraj: zahteva.params.oblika == 'html' ? true : false,
        postavkeRacuna: pesmi
      })  
    }
  })
})

// Privzeto izpiši račun v HTML obliki
streznik.get('/izpisiRacun', function(zahteva, odgovor) {
  odgovor.redirect('/izpisiRacun/html')
})

// Vrni stranke iz podatkovne baze
var vrniStranke = function(callback) {
  pb.all("SELECT * FROM Customer",
    function(napaka, vrstice) {
      callback(napaka, vrstice);
    }
  );
}

// Vrni račune iz podatkovne baze
var vrniRacune = function(callback) {
  pb.all("SELECT Customer.FirstName || ' ' || Customer.LastName || ' (' || Invoice.InvoiceId || ') - ' || date(Invoice.InvoiceDate) AS Naziv, \
          Invoice.InvoiceId \
          FROM Customer, Invoice \
          WHERE Customer.CustomerId = Invoice.CustomerId",
    function(napaka, vrstice) {
      callback(napaka, vrstice);
    }
  );
}

// Registracija novega uporabnika
streznik.post('/prijava', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  
  form.parse(zahteva, function (napaka1, polja, datoteke) {
    var napaka2 = false;
    try {
      var stmt = pb.prepare("\
        INSERT INTO Customer \
    	  (FirstName, LastName, Company, \
    	  Address, City, State, Country, PostalCode, \
    	  Phone, Fax, Email, SupportRepId) \
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
      //TODO: add fields and finalize
      //stmt.run("", "", "", "", "", "", "", "", "", "", "", 3); 
      //stmt.finalize();
    } catch (err) {
      napaka2 = true;
    }
  
    odgovor.end();
  });
})

// Prikaz strani za prijavo
streznik.get('/prijava', function(zahteva, odgovor) {
  vrniStranke(function(napaka1, stranke) {
      vrniRacune(function(napaka2, racuni) {
        odgovor.render('prijava', {sporocilo: "", seznamStrank: stranke, seznamRacunov: racuni});  
      }) 
    });
})

// Prikaz nakupovalne košarice za stranko
streznik.post('/stranka', function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  
  form.parse(zahteva, function (napaka1, polja, datoteke) {
    /* glede na prijava.ejs, vrstica 66:
       <option value="<%= stranka.CustomerId %>" selected>
       
       v tej tocki pridobimo identifikator uporabnika v bazi - to si shranimo
       v sejo, nato pa preusmerimo uporabnika na glavno stran (ki ima sedaj
       znanega lastnika kosarice)
       
       Ime izbirnega okna je seznamStrank, in to je tudi kljuc za izbrano
       vrednost.
       */
    zahteva.session.uporabnik = polja.seznamStrank;
    
    odgovor.redirect('/')
  });
})

// Odjava stranke
streznik.post('/odjava', function(zahteva, odgovor) {
  /* mi ob odjavi pozabimo na uporabnika ter na vsebino njegove kosarice s tem
     da unicimo objekt seje -
     meni osebno sicer ni popolnoma jasno, kdaj naj bi mi sicer zapisali
     vsebino kosarice z bazo, mogoce takrat, ko pritisnemo gumb za izpis
     racuna? - je pa nekoliko nerodno da niso podali SQL stavka za to, ker
     v tem primeru je potrebno dodati nove vrstice v Invoice ter InvoiceLine */
    zahteva.session.destroy();
    
    odgovor.redirect('/prijava') 
})



streznik.listen(process.env.PORT, function() {
  console.log("Strežnik pognan!");
})
