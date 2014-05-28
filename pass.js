var createTemplate = require("passbook");
var crypto = require('crypto');
var _ = require('underscore');

var mongo = require('mongodb');
var Grid = require('gridfs-stream');

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
            value : "-50%"
          }
        ],
        secondaryFields : [
          {
            key : "addInfo",
            label : "Предложение для",
            value : "Всех посетителей"
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
    if (!images || !images.icon || !images.logo){
      p.loadImagesFrom(IMAGE_FOLDER);
    }else{
      var future = new Future;
      var onComplete = future.resolver();
      var mongoDb;
      MongoClient.connect('mongodb://smartplaces:EvystVtcnf@oceanic.mongohq.com:10091/smartplaces', function(err, db) {
        mongoDb=db;
        onComplete(err,db);
      });
      future.wait();

      var gfs = Grid(db, mongo);
      var bufs = [];
      var logoStream = gfs.createReadStream({_id: new mongo.ObjectId(images.logo.key)});
      logoStream.on('data', function(d){ bufs.push(d); });
      logoStream.on('end', function(){
          var image = Buffer.concat(bufs);
          p.images.logo = image
          p.images.logo2x = image
          p.icon = image;
          p.icon2x = image;
      });
      p.render(res, callback);
    }
  }

};

module.exports = pass;
