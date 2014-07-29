var createTemplate = require("passbook");
var crypto = require('crypto');
var _ = require('underscore');

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var Grid = require('mongodb').Grid;

var Future = require('fibers/future');

var KEYS_FOLDER = "./keys/";
var KEYS_PASSWORD = "123456";
var IMAGE_FOLDER = "./images"

var pass = {
  defaultJSON: function(serialNumber,passType){
    shasum = crypto.createHash('sha1');
    shasum.update("SHA"+Math.random());

    return {
      formatVersion: 1,
      passTypeIdentifier: passType || "pass.ru.smartplaces.coupon",
      teamIdentifier:     "Y77QB88576",
      webServiceURL: "https://sleepy-scrubland-4869.herokuapp.com/passws/",
      authenticationToken: ""+shasum.digest('hex'),
      organizationName: "SmartPlaces",
      description:   "Купон от SmartPlaces",
      backgroundColor:   "rgb(237,216,216)",
      foregroundColor: "rgb(247,7,65)",
      labelColor: "rgb(13,21,237)",

      serialNumber:  serialNumber || "SN"+new Date().getTime(),

      logoText: "Smar Coffe",

      barcode : {
        message : "1234567",
        format : "PKBarcodeFormatPDF417",
        messageEncoding : "utf-8"
      },

      beacons:[
        {
          proximityUUID:"E2C56DB5-DFFB-48D2-B060-D0F5A71096E0",
          relevantText:"Hi, SmartPlace is near!"
        }
      ],

      coupon: {
        primaryFields : [
          {
            key : "offer",
            label : "на американо",
            value : "-50%",
            changeMessage : "Ваша новая скидка: %@"
          }
        ],
        secondaryFields : [
          {
            key : "addInfo",
            label : "Предложение для",
            value : "Всех посетителей",
            changeMessage : "Теперь предложение для: %@"
          }
        ],
        backFields : [
          {
            "key" : "terms",
            "label" : "УСЛОВИЯ ИСПОЛЬЗОВАНИЯ",
            "value" : "Это купон создан компанией SmartPlaces и является ее собственностью."
          }
        ]
      }
    };
  },

  render: function(json, images, res, callback){
    var template = createTemplate("coupon", {passTypeIdentifier:json.passTypeIdentifier, teamIdentifier:json.teamIdentifier});
    template.keys(KEYS_FOLDER, KEYS_PASSWORD);
    var p = template.createPass(_.omit(json,'passTypeIdentifier','teamIdentifier'));
    p.loadImagesFrom(IMAGE_FOLDER);
    if (images && (images.icon || images.logo || images.strip)){
      MongoClient.connect('mongodb://smartplaces:EvystVtcnf@oceanic.mongohq.com:10091/smartplaces', function(err, db) {
        if(err) {
          res.send(500);
          return console.dir(err);
        }
        var gLogos = new Grid(db, 'cfs_gridfs.logos');
        var gIcons = new Grid(db, 'cfs_gridfs.icons');
        var gStrips = new Grid(db, 'cfs_gridfs.strips');

        if (images.logo && images.icon){
          gLogos.get(new ObjectID(images.logo.key), function(err, data) {
            if(err) {
              res.send(500);
              console.log('Logo extraction error');
              return console.dir(err);
            }
            p.images.logo = data;
            p.images.logo2x = data;

            gIcons.get(new ObjectID(images.icon.key), function(err, data) {
              if(err) {
                res.send(500);
                console.log('Icon extraction error');
                return console.dir(err);
              }
              p.images.icon = data;
              p.images.icon2x = data;

              if (images.strip){
                gStrips.get(new ObjectID(images.strip.key),function(err,data){
                  if(err) {
                    res.send(500);
                    console.log('Strip extraction error');
                    return console.dir(err);
                  }
                  p.images.strip = data;
                  p.images.strip2x = data;

                  p.render(res,callback);
                });
              }else{
                p.render(res,callback);
              }

            });
          });
        }else{
          if (images.strip){
            gStrips.get(new ObjectID(images.strip.key),function(err,data){
              if(err) {
                res.send(500);
                console.log('Strip extraction error');
                return console.dir(err);
              }
              p.images.strip = data;
              p.images.strip2x = data;

              p.render(res,callback);
            });
          }else{
            p.render(res,callback);
          }
        }

      });
    }
  }
};


module.exports = pass;
